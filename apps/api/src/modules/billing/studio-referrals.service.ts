import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@platform/database';
import {
  DEFAULT_REFERRAL_REWARD,
  REFERRAL_TRACKING_PARAM,
  ReferralRewardSettingSchema,
  creditBalanceOf,
  isSelfReferral,
  referralRewardEntry,
} from '@platform/shared';
import type {
  AdminReferralOverviewDTO,
  CreditBalance,
  ReferralParty,
  ReferralRewardSetting,
  StudioReferralItemDTO,
  StudioReferralOverviewDTO,
  StudioReferralRejectReason,
  StudioReferralSource,
  StudioReferralStatus,
  UpdatePlatformBillingSettingsInput,
} from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { generateReferralCode } from '../feedback/referral-code';

const SETTINGS_ID = 'platform';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Business-to-business referrals (G5c-1, docs/DENEME_VE_ETKINLESTIRME.md).
 *
 * - Every studio has one platform-level code (Studio.platformReferralCode).
 * - A visitor arriving on the platform site with ?pw_ref=CODE gets a
 *   touchpoint with refCode on the platform tenant; when that visitor's
 *   contact later becomes a studio owner (super admin creates the tenant
 *   with the same phone), the referring studio is recorded. The super admin
 *   may also enter the code by hand at creation (source MANUAL).
 * - The reward is written only when the referred studio pays (activation),
 *   once per referred studio (unique referredStudioId, conditional status
 *   update and a ledger idempotency key), never for a self-referral.
 */
@Injectable()
export class StudioReferralsService {
  private readonly logger = new Logger(StudioReferralsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Codes and the owner's page
  // ---------------------------------------------------------------------------

  async codeFor(studioId: string): Promise<string> {
    const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: studioId }, select: { platformReferralCode: true } });
    if (studio.platformReferralCode) return studio.platformReferralCode;
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateReferralCode(8);
      try {
        const updated = await this.prisma.studio.updateMany({ where: { id: studioId, platformReferralCode: null }, data: { platformReferralCode: code } });
        if (updated.count === 1) return code;
        const again = await this.prisma.studio.findUniqueOrThrow({ where: { id: studioId }, select: { platformReferralCode: true } });
        if (again.platformReferralCode) return again.platformReferralCode;
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
      }
    }
    throw new Error('Could not allocate a unique referral code');
  }

  async overview(studioId: string): Promise<StudioReferralOverviewDTO> {
    const code = await this.codeFor(studioId);
    const [rows, ledger, reward] = await Promise.all([
      this.prisma.studioReferral.findMany({
        where: { referrerStudioId: studioId },
        include: { referred: { select: { name: true } }, creditEntries: { where: { kind: 'REFERRAL_REWARD' } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.platformCreditLedger.findMany({ where: { studioId }, select: { amount: true, currency: true, months: true } }),
      this.rewardSetting(),
    ]);
    const referrals: StudioReferralItemDTO[] = rows.map((r) => {
      const entry = r.creditEntries[0];
      return {
        id: r.id,
        referredStudioName: r.referred.name,
        status: r.status as StudioReferralStatus,
        rejectReason: (r.rejectReason as StudioReferralRejectReason | null) ?? null,
        createdAt: r.createdAt.toISOString(),
        rewardedAt: r.rewardedAt?.toISOString() ?? null,
        reward: entry ? { amount: entry.amount ? entry.amount.toFixed(2) : null, currency: entry.currency, months: entry.months } : null,
      };
    });
    return { code, query: `?${REFERRAL_TRACKING_PARAM}=${code}`, referrals, credit: balanceOf(ledger), reward };
  }

  // ---------------------------------------------------------------------------
  // Signup attribution
  // ---------------------------------------------------------------------------

  /**
   * Called after the super admin created a tenant. An explicit code wins;
   * otherwise the owner's platform contact is looked up by phone and its
   * most recent touchpoint carrying a referral code inside the platform's
   * attribution window names the referrer. Never throws.
   */
  async recordSignup(referredStudioId: string, ownerPhone: string, explicitCode?: string | null, now = new Date()): Promise<void> {
    try {
      const found = explicitCode ? await this.byCode(explicitCode, 'MANUAL', null) : await this.fromTouchpoints(ownerPhone, now);
      if (!found) return;
      const selfReferral = isSelfReferral(await this.party(found.referrerStudioId), await this.party(referredStudioId, [ownerPhone]));
      await this.prisma.studioReferral.create({
        data: {
          referrerStudioId: found.referrerStudioId,
          referredStudioId,
          code: found.code,
          source: found.source,
          touchpointId: found.touchpointId,
          status: selfReferral ? 'REJECTED' : 'SIGNED_UP',
          rejectReason: selfReferral ? 'SELF_REFERRAL' : null,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return;
      this.logger.warn(`Referral signup for ${referredStudioId} not recorded: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async byCode(code: string, source: StudioReferralSource, touchpointId: string | null) {
    const referrer = await this.prisma.studio.findUnique({ where: { platformReferralCode: code.trim().toUpperCase() }, select: { id: true, isPlatform: true } });
    if (!referrer || referrer.isPlatform) return null;
    return { referrerStudioId: referrer.id, code: code.trim().toUpperCase(), source, touchpointId };
  }

  private async fromTouchpoints(ownerPhone: string, now: Date) {
    const platform = await this.prisma.studio.findFirst({ where: { isPlatform: true }, select: { id: true, attributionWindowDays: true } });
    if (!platform) return null;
    const contact = await this.prisma.contact.findFirst({
      where: { studioId: platform.id, phone: ownerPhone, mergedIntoId: null },
      select: { id: true },
    });
    if (!contact) return null;
    const touch = await this.prisma.touchpoint.findFirst({
      where: {
        studioId: platform.id,
        contactId: contact.id,
        refCode: { not: null },
        occurredAt: { lte: now, gte: new Date(now.getTime() - platform.attributionWindowDays * DAY_MS) },
      },
      orderBy: { occurredAt: 'desc' },
      select: { id: true, refCode: true },
    });
    if (!touch?.refCode) return null;
    return this.byCode(touch.refCode, 'TOUCHPOINT', touch.id);
  }

  /** Owner phones and emails of a studio (active or invited owner memberships), plus extra known phones. */
  private async party(studioId: string, extraPhones: readonly string[] = []): Promise<ReferralParty> {
    const owners = await this.prisma.membership.findMany({
      where: { studioId, roleTemplate: { isOwner: true } },
      select: { user: { select: { phone: true, email: true } } },
    });
    const invites = await this.prisma.inviteToken.findMany({
      where: { studioId, roleTemplate: { isOwner: true } },
      select: { phone: true },
    });
    return {
      studioId,
      ownerPhones: [...owners.map((o) => o.user.phone), ...invites.map((i) => i.phone), ...extraPhones],
      ownerEmails: owners.map((o) => o.user.email),
    };
  }

  // ---------------------------------------------------------------------------
  // Reward
  // ---------------------------------------------------------------------------

  /**
   * The referred studio paid. Re-checks self-referral with the owners now
   * known (an owner accepted the invite after signup), then moves the
   * referral SIGNED_UP -> REWARDED and writes one ledger row, both in one
   * transaction and both idempotent. Never throws.
   */
  async onReferredStudioActivated(referredStudioId: string): Promise<void> {
    try {
      const referral = await this.prisma.studioReferral.findUnique({ where: { referredStudioId } });
      if (!referral || referral.status !== 'SIGNED_UP') return;
      if (isSelfReferral(await this.party(referral.referrerStudioId), await this.party(referredStudioId))) {
        await this.prisma.studioReferral.updateMany({
          where: { id: referral.id, status: 'SIGNED_UP' },
          data: { status: 'REJECTED', rejectReason: 'SELF_REFERRAL' },
        });
        return;
      }
      const referrer = await this.prisma.studio.findUnique({ where: { id: referral.referrerStudioId }, select: { isActive: true } });
      if (!referrer?.isActive) {
        await this.prisma.studioReferral.updateMany({
          where: { id: referral.id, status: 'SIGNED_UP' },
          data: { status: 'REJECTED', rejectReason: 'REFERRER_INACTIVE' },
        });
        return;
      }
      const entry = referralRewardEntry(await this.rewardSetting());
      await this.prisma.$transaction(async (tx) => {
        const moved = await tx.studioReferral.updateMany({
          where: { id: referral.id, status: 'SIGNED_UP' },
          data: { status: 'REWARDED', rewardedAt: new Date() },
        });
        if (moved.count === 0) return;
        await tx.platformCreditLedger.create({
          data: {
            studioId: referral.referrerStudioId,
            kind: 'REFERRAL_REWARD',
            amount: entry.amount,
            currency: entry.currency,
            months: entry.months,
            referralId: referral.id,
            idempotencyKey: `referral-reward:${referredStudioId}`,
          },
        });
        await tx.auditLog.create({
          data: {
            studioId: referral.referrerStudioId,
            userId: null,
            action: 'billing.referral_reward',
            entityType: 'StudioReferral',
            entityId: referral.id,
            metadata: { referredStudioId, amount: entry.amount, currency: entry.currency, months: entry.months },
          },
        });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return;
      this.logger.warn(`Referral reward for ${referredStudioId} not written: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Settings and super-admin overview
  // ---------------------------------------------------------------------------

  async rewardSetting(): Promise<ReferralRewardSetting> {
    const row = await this.prisma.platformBillingSettings.findUnique({ where: { id: SETTINGS_ID } });
    if (!row) return DEFAULT_REFERRAL_REWARD;
    const parsed = ReferralRewardSettingSchema.safeParse(
      row.referralRewardKind === 'AMOUNT'
        ? { kind: 'AMOUNT', amount: row.referralRewardAmount?.toFixed(2), currency: row.referralRewardCurrency }
        : { kind: 'FREE_MONTHS', months: row.referralRewardMonths },
    );
    return parsed.success ? parsed.data : DEFAULT_REFERRAL_REWARD;
  }

  async updateSettings(actorUserId: string, dto: UpdatePlatformBillingSettingsInput): Promise<{ referralReward: ReferralRewardSetting }> {
    const reward = dto.referralReward;
    const data =
      reward.kind === 'AMOUNT'
        ? { referralRewardKind: 'AMOUNT', referralRewardAmount: reward.amount, referralRewardCurrency: reward.currency, referralRewardMonths: null }
        : { referralRewardKind: 'FREE_MONTHS', referralRewardAmount: null, referralRewardCurrency: null, referralRewardMonths: reward.months };
    await this.prisma.platformBillingSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...data, updatedByUserId: actorUserId },
      update: { ...data, updatedByUserId: actorUserId },
    });
    await this.prisma.auditLog.create({
      data: { studioId: null, userId: actorUserId, action: 'billing.settings_update', entityType: 'PlatformBillingSettings', entityId: SETTINGS_ID, metadata: { referralReward: reward } },
    });
    return { referralReward: await this.rewardSetting() };
  }

  async adminOverview(): Promise<AdminReferralOverviewDTO> {
    const [rows, reward] = await Promise.all([
      this.prisma.studioReferral.findMany({
        include: { referrer: { select: { name: true } }, referred: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
      this.rewardSetting(),
    ]);
    const totals = { signedUp: 0, rewarded: 0, rejected: 0 };
    for (const r of rows) {
      if (r.status === 'REWARDED') totals.rewarded++;
      else if (r.status === 'REJECTED') totals.rejected++;
      else totals.signedUp++;
    }
    return {
      reward,
      totals,
      items: rows.map((r) => ({
        id: r.id,
        referrerStudioId: r.referrerStudioId,
        referrerStudioName: r.referrer.name,
        referredStudioId: r.referredStudioId,
        referredStudioName: r.referred.name,
        code: r.code,
        source: r.source as StudioReferralSource,
        status: r.status as StudioReferralStatus,
        rejectReason: (r.rejectReason as StudioReferralRejectReason | null) ?? null,
        createdAt: r.createdAt.toISOString(),
        rewardedAt: r.rewardedAt?.toISOString() ?? null,
      })),
    };
  }
}

function balanceOf(rows: { amount: Prisma.Decimal | null; currency: string | null; months: number | null }[]): CreditBalance {
  return creditBalanceOf(rows.map((r) => ({ amount: r.amount ? r.amount.toFixed(2) : null, currency: r.currency, months: r.months })));
}
