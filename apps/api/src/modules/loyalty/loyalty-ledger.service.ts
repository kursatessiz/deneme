import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@platform/database';
import type { LoyaltyLedger } from '@platform/database';
import { addMonthsUtc, remainingLots } from '@platform/shared';
import type { LoyaltyExpiryMode, LoyaltyReason, LoyaltySourceType } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { loyaltyError } from './loyalty.errors';

type Tx = Prisma.TransactionClient;

export interface LoyaltySettingsRow {
  enabled: boolean;
  expiryMode: LoyaltyExpiryMode;
  expiryMonths: number | null;
  expiryNoticeDays: number;
  memberRedeemEnabled: boolean;
}

export const DEFAULT_LOYALTY_SETTINGS: LoyaltySettingsRow = {
  enabled: false,
  expiryMode: 'NONE',
  expiryMonths: null,
  expiryNoticeDays: 14,
  memberRedeemEnabled: false,
};

export interface LedgerPostInput {
  studioId: string;
  membershipId: string;
  delta: number;
  reason: LoyaltyReason;
  sourceType: LoyaltySourceType;
  sourceId: string;
  ruleId?: string | null;
  note?: string | null;
  createdByMembershipId?: string | null;
  now?: Date;
}

export interface LedgerPostResult {
  entry: LoyaltyLedger;
  /** The idempotency key (studio, source, reason) was already used: nothing changed. */
  duplicate: boolean;
  balance: number;
}

interface LockedAccount {
  id: string;
  studio_id: string;
  balance: number;
  next_expiry_at: Date | null;
}

/**
 * The only writer of the loyalty ledger (docs/SADAKAT.md). Every write:
 * 1. creates the member's account row if missing and locks it (FOR UPDATE),
 *    which serialises all ledger writes of one member;
 * 2. returns the existing row when the idempotency key (studio, source type,
 *    source id, reason) was already used, so hooks and retries never credit
 *    twice;
 * 3. refuses a debit that would take the balance below zero (409);
 * 4. appends the row with the balance after it and updates the cached
 *    balance in the same transaction. Rows are never updated or deleted.
 */
@Injectable()
export class LoyaltyLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async settings(studioId: string, client: Tx | PrismaService = this.prisma): Promise<LoyaltySettingsRow> {
    const row = await client.loyaltySettings.findUnique({ where: { studioId } });
    if (!row) return { ...DEFAULT_LOYALTY_SETTINGS };
    return {
      enabled: row.enabled,
      expiryMode: row.expiryMode,
      expiryMonths: row.expiryMonths,
      expiryNoticeDays: row.expiryNoticeDays,
      memberRedeemEnabled: row.memberRedeemEnabled,
    };
  }

  /** Expiry of a lot earned at `now` under the tenant policy (null = never). */
  lotExpiry(settings: LoyaltySettingsRow, now: Date): Date | null {
    if (settings.expiryMode !== 'MONTHS_AFTER_EARN' || !settings.expiryMonths) return null;
    return addMonthsUtc(now, settings.expiryMonths);
  }

  /** Appends one row inside its own transaction. */
  async post(input: LedgerPostInput): Promise<LedgerPostResult> {
    return this.prisma.$transaction((tx) => this.postTx(tx, input));
  }

  /** Appends one row inside the caller's transaction (see the class comment). */
  async postTx(tx: Tx, input: LedgerPostInput): Promise<LedgerPostResult> {
    const now = input.now ?? new Date();
    if (!Number.isInteger(input.delta) || input.delta === 0) throw new Error('Loyalty delta must be a non-zero integer');

    await tx.$executeRaw`
      INSERT INTO "loyalty_accounts" ("id", "studio_id", "membership_id", "balance", "lifetime_earned", "lifetime_redeemed", "created_at", "updated_at")
      SELECT ${randomUUID()}::uuid, m."studio_id", m."id", 0, 0, 0, ${now}, ${now}
      FROM "memberships" m
      WHERE m."id" = ${input.membershipId}::uuid AND m."studio_id" = ${input.studioId}::uuid
      ON CONFLICT ("membership_id") DO NOTHING`;
    const [account] = await tx.$queryRaw<LockedAccount[]>`
      SELECT "id", "studio_id"::text AS studio_id, "balance", "next_expiry_at"
      FROM "loyalty_accounts"
      WHERE "membership_id" = ${input.membershipId}::uuid AND "studio_id" = ${input.studioId}::uuid
      FOR UPDATE`;
    // No account means the membership does not belong to this studio.
    if (!account) throw new Error(`Membership ${input.membershipId} is not in studio ${input.studioId}`);

    const existing = await tx.loyaltyLedger.findUnique({
      where: {
        studioId_sourceType_sourceId_reason: { studioId: input.studioId, sourceType: input.sourceType, sourceId: input.sourceId, reason: input.reason },
      },
    });
    if (existing) return { entry: existing, duplicate: true, balance: account.balance };

    const balance = account.balance + input.delta;
    if (balance < 0) throw loyaltyError('LOYALTY_INSUFFICIENT_BALANCE');

    let expiresAt: Date | null = null;
    if (input.delta > 0) {
      expiresAt = this.lotExpiry(await this.settings(input.studioId, tx), now);
    }
    const nextExpiryAt =
      expiresAt && (!account.next_expiry_at || expiresAt.getTime() < account.next_expiry_at.getTime()) ? expiresAt : account.next_expiry_at;

    await tx.loyaltyAccount.update({
      where: { id: account.id },
      data: {
        balance,
        nextExpiryAt,
        ...(input.delta > 0 ? { lifetimeEarned: { increment: input.delta } } : {}),
        ...(input.reason === 'REDEEM' ? { lifetimeRedeemed: { increment: -input.delta } } : {}),
      },
    });
    const contact = await tx.contact.findFirst({
      where: { studioId: input.studioId, membershipId: input.membershipId, mergedIntoId: null },
      select: { id: true },
    });
    const entry = await tx.loyaltyLedger.create({
      data: {
        studioId: input.studioId,
        membershipId: input.membershipId,
        contactId: contact?.id ?? null,
        delta: input.delta,
        balanceAfter: balance,
        reason: input.reason,
        sourceType: input.sourceType,
        sourceId: input.sourceId.slice(0, 120),
        ruleId: input.ruleId ?? null,
        expiresAt,
        createdByMembershipId: input.createdByMembershipId ?? null,
        note: input.note ? input.note.slice(0, 300) : null,
        createdAt: now,
      },
    });
    return { entry, duplicate: false, balance };
  }

  /**
   * Writes off every lot of one member that is past its expiry with points
   * left (FIFO, packages/shared loyalty.ts remainingLots) as negative
   * EXPIRED rows keyed by the lot, then moves the account's recheck hint to
   * the next lot that can still expire. Safe to run any number of times.
   */
  async expireMember(studioId: string, membershipId: string, now: Date): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "loyalty_accounts" WHERE "membership_id" = ${membershipId}::uuid AND "studio_id" = ${studioId}::uuid FOR UPDATE`;
      const rows = await tx.loyaltyLedger.findMany({
        where: { studioId, membershipId },
        select: { id: true, delta: true, expiresAt: true, createdAt: true },
      });
      let expired = 0;
      const written: { id: string; delta: number; expiresAt: Date | null; createdAt: Date }[] = [];
      for (const lot of remainingLots(rows)) {
        if (lot.remaining <= 0 || !lot.expiresAt || lot.expiresAt.getTime() > now.getTime()) continue;
        const result = await this.postTx(tx, {
          studioId,
          membershipId,
          delta: -lot.remaining,
          reason: 'EXPIRED',
          sourceType: 'lot',
          sourceId: lot.id,
          now,
        });
        if (!result.duplicate) {
          expired += lot.remaining;
          written.push({ id: result.entry.id, delta: result.entry.delta, expiresAt: null, createdAt: result.entry.createdAt });
        }
      }
      const next = remainingLots([...rows, ...written])
        .filter((l) => l.remaining > 0 && l.expiresAt !== null && l.expiresAt.getTime() > now.getTime())
        .map((l) => l.expiresAt as Date)
        .sort((a, b) => a.getTime() - b.getTime())[0];
      await tx.loyaltyAccount.updateMany({ where: { studioId, membershipId }, data: { nextExpiryAt: next ?? null } });
      return expired;
    });
  }

  /** Current lot remainders of one member (for the next-expiry line and notices). */
  async lots(studioId: string, membershipId: string) {
    const rows = await this.prisma.loyaltyLedger.findMany({
      where: { studioId, membershipId },
      select: { id: true, delta: true, expiresAt: true, createdAt: true },
    });
    return { rows, remaining: remainingLots(rows) };
  }
}
