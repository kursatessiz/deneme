import { Injectable, Logger } from '@nestjs/common';
import { LOYALTY_EXPIRY_TEMPLATE_KEY, expiringWithin } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingService } from '../messaging/engine/messaging.service';
import { LoyaltyLedgerService } from './loyalty-ledger.service';
import { LoyaltyEarnService } from './loyalty-earn.service';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Accounts handled per heartbeat and step; the rest follow on the next run. */
const BATCH = 500;

export interface LoyaltyHeartbeatResult {
  birthdayPoints: number;
  expiredMembers: number;
  expiredPoints: number;
  expiryNotices: number;
}

/**
 * Loyalty work on the scheduler heartbeat (JobsService): birthday points,
 * FIFO expiry of lots past their date, and the "points expiring soon"
 * notice. Each step is idempotent: birthday rows are keyed per member and
 * year, EXPIRED rows per lot, and a notice is sent once per member and
 * expiry date (account.expiryNoticeFor plus the messaging idempotency key).
 *
 * The notice is sent as TRANSACTIONAL: it only tells the member about
 * their own balance and carries no offer, like a package expiry reminder
 * (documented in docs/SADAKAT.md). Quiet hours still apply in the engine.
 */
@Injectable()
export class LoyaltyJobsService {
  private readonly logger = new Logger(LoyaltyJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LoyaltyLedgerService,
    private readonly earn: LoyaltyEarnService,
    private readonly messaging: MessagingService,
  ) {}

  async run(now: Date): Promise<LoyaltyHeartbeatResult> {
    const birthdayPoints = await this.earn.awardBirthdays(now);
    const expiry = await this.expireDue(now);
    const expiryNotices = await this.notifyExpiring(now);
    return { birthdayPoints, expiredMembers: expiry.members, expiredPoints: expiry.points, expiryNotices };
  }

  async expireDue(now: Date): Promise<{ members: number; points: number }> {
    const due = await this.prisma.loyaltyAccount.findMany({
      where: { nextExpiryAt: { lte: now } },
      select: { studioId: true, membershipId: true },
      orderBy: { nextExpiryAt: 'asc' },
      take: BATCH,
    });
    let members = 0;
    let points = 0;
    for (const account of due) {
      try {
        const expired = await this.ledger.expireMember(account.studioId, account.membershipId, now);
        if (expired > 0) {
          members += 1;
          points += expired;
        }
      } catch (err) {
        this.logger.warn(`Loyalty expiry failed for ${account.membershipId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { members, points };
  }

  async notifyExpiring(now: Date): Promise<number> {
    const studios = await this.prisma.loyaltySettings.findMany({
      where: { enabled: true, expiryMode: 'MONTHS_AFTER_EARN', expiryNoticeDays: { gt: 0 } },
      select: { studioId: true, expiryNoticeDays: true, studio: { select: { timezone: true, defaultLocale: true } } },
    });
    let sent = 0;
    for (const settings of studios) {
      const until = new Date(now.getTime() + settings.expiryNoticeDays * DAY_MS);
      // Accounts already notified for their current expiry date are excluded in the
      // query (a column-to-column comparison Prisma cannot express), so the batch is
      // not filled with accounts that need no notice.
      const pending = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT "id"::text AS id FROM "loyalty_accounts"
        WHERE "studio_id" = ${settings.studioId}::uuid AND "balance" > 0
          AND "next_expiry_at" > ${now} AND "next_expiry_at" <= ${until}
          AND ("expiry_notice_for" IS NULL OR "expiry_notice_for" <> "next_expiry_at")
        ORDER BY "next_expiry_at" ASC, "id" ASC
        LIMIT ${BATCH}`;
      const accounts = pending.length
        ? await this.prisma.loyaltyAccount.findMany({
            where: { studioId: settings.studioId, id: { in: pending.map((r) => r.id) } },
            select: { id: true, membershipId: true, nextExpiryAt: true, expiryNoticeFor: true },
            orderBy: [{ nextExpiryAt: 'asc' }, { id: 'asc' }],
          })
        : [];
      for (const account of accounts) {
        if (!account.nextExpiryAt) continue;
        if (account.expiryNoticeFor && account.expiryNoticeFor.getTime() === account.nextExpiryAt.getTime()) continue;
        try {
          const { rows } = await this.ledger.lots(settings.studioId, account.membershipId);
          const expiring = expiringWithin(rows, now, until);
          if (expiring.points > 0 && expiring.firstExpiresAt) {
            const expiryDate = formatDate(expiring.firstExpiresAt, settings.studio.defaultLocale, settings.studio.timezone);
            const result = await this.messaging.send({
              studioId: settings.studioId,
              recipient: { membershipId: account.membershipId },
              purpose: 'TRANSACTIONAL',
              templateKey: LOYALTY_EXPIRY_TEMPLATE_KEY,
              variables: { points: expiring.points, expiryDate },
              idempotencyKey: `loyalty-expiry:${account.membershipId}:${expiring.firstExpiresAt.toISOString().slice(0, 10)}`,
            });
            if (result.success && !result.duplicate) sent += 1;
          }
          // Marked even when no channel delivered: one attempt per expiry date, never a daily repeat.
          await this.prisma.loyaltyAccount.update({ where: { id: account.id }, data: { expiryNoticeFor: account.nextExpiryAt } });
        } catch (err) {
          this.logger.warn(`Loyalty expiry notice failed for ${account.membershipId}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    return sent;
  }
}

function formatDate(date: Date, locale: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}
