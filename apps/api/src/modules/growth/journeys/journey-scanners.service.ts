import { Injectable } from '@nestjs/common';
import { Prisma } from '@platform/database';
import { BASE_MESSAGES, BUNDLED_MESSAGES, createTranslator } from '@platform/shared';
import type { JourneyTrigger, ScannedJourneyTrigger } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CrmHooksService } from '../../crm/hooks/crm-hooks.service';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Candidates fetched per journey per heartbeat. */
export const SCAN_LIMIT = 500;
/** Most recent enrollment references of a journey excluded from a scan. */
const ENROLLED_REF_LIMIT = 5000;

/** One contact a time-based trigger found. */
export interface ScannedCandidate {
  contactId: string;
  /** Enrollment idempotency reference (booking id, package id, ...). */
  ref: string;
  occurredAt: Date;
  variables: Record<string, string>;
  /** What the W10 runner would have recorded for this target (no double sending after migration). */
  legacy: { userId: string; targetRef: string } | null;
}

interface StudioInfo {
  timezone: string;
  defaultLocale: string;
}

/** ISO-week bucket, e.g. "2026-W04" (the W10 win-back target reference). */
export function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / DAY_MS - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function formatDateTime(date: Date, locale: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'short', timeStyle: 'short' }).format(date);
  } catch {
    return date.toISOString();
  }
}

function localMonthDay(date: Date, timeZone: string): { month: number; day: number; year: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(date);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
    return { month: get('month'), day: get('day'), year: get('year') };
  } catch {
    return { month: date.getUTCMonth() + 1, day: date.getUTCDate(), year: date.getUTCFullYear() };
  }
}

/**
 * Time-based journey triggers (G2a). These replace the six W10 rule
 * evaluators: the queries are the same business questions (sessions about
 * to start, packages about to end, birthdays, no-shows, first visits), but
 * instead of sending they return candidates the engine enrolls, each with
 * the reference the W10 runner used so a migrated journey never repeats a
 * message the old runner already sent. Partner guests who never onboarded
 * are excluded from every scan, as before.
 */
@Injectable()
export class JourneyScannersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crm: CrmHooksService,
  ) {}

  async scan(
    studioId: string,
    trigger: Extract<JourneyTrigger, { kind: 'event' }> & { event: ScannedJourneyTrigger },
    now: Date,
    floor: Date,
    journeyId?: string,
  ): Promise<ScannedCandidate[]> {
    const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: studioId }, select: { timezone: true, defaultLocale: true } });
    // Already-enrolled candidates are excluded inside each query, so the SCAN_LIMIT
    // window is spent on candidates that can still enroll (newest ones included).
    const enrolled = await this.enrolledRefs(journeyId);
    switch (trigger.event) {
      case 'booking_upcoming':
        return this.bookingUpcoming(studioId, studio, trigger.leadMinutes ?? 120, now, enrolled);
      case 'package_expiring':
        return this.packageExpiring(studioId, studio, trigger.daysBefore, trigger.remainingUnitsAtMost, now, enrolled);
      case 'package_expired':
        return this.packageExpired(studioId, studio, now, floor, enrolled);
      case 'birthday':
        return this.birthday(studioId, studio, trigger.daysBefore ?? 0, now, journeyId);
      case 'no_show':
        return this.noShows(studioId, studio, now, floor, enrolled);
      case 'session_attended':
        return this.attended(studioId, studio, now, floor, enrolled);
      case 'first_session_attended':
        return this.firstAttended(studioId, studio, now, floor, journeyId);
      case 'churn_risk_high':
        return this.churnHigh(studioId, now, floor, journeyId);
    }
  }

  // ---------------------------------------------------------------------------

  /**
   * Trigger references this journey already enrolled (most recent first, bounded).
   * Scanners whose reference is the row id (booking or package id) exclude them with
   * `id notIn`; a stale entry beyond the bound is still caught by the enrollment's
   * unique index, it only costs a slot.
   */
  private async enrolledRefs(journeyId: string | undefined): Promise<string[]> {
    if (!journeyId) return [];
    const rows = await this.prisma.journeyEnrollment.findMany({
      where: { journeyId },
      select: { triggerRef: true },
      orderBy: { enteredAt: 'desc' },
      take: ENROLLED_REF_LIMIT,
    });
    return rows.map((r) => r.triggerRef);
  }

  private async bookingUpcoming(studioId: string, studio: StudioInfo, leadMinutes: number, now: Date, enrolled: string[]): Promise<ScannedCandidate[]> {
    const bookings = await this.prisma.booking.findMany({
      where: {
        studioId,
        status: 'CONFIRMED',
        id: { notIn: enrolled },
        schedule: { startTime: { gt: now, lte: new Date(now.getTime() + leadMinutes * 60_000) }, isCancelled: false },
      },
      select: { id: true, member: { select: memberSelect }, schedule: { select: { startTime: true, title: true, serviceType: { select: { name: true } } } } },
      orderBy: [{ schedule: { startTime: 'asc' } }, { id: 'asc' }],
      take: SCAN_LIMIT,
    });
    return this.toCandidates(studioId, bookings, (b, locale) => ({
      ref: b.id,
      occurredAt: now,
      variables: { serviceName: b.schedule.serviceType?.name ?? b.schedule.title, startTime: formatDateTime(b.schedule.startTime, locale, studio.timezone) },
      targetRef: b.id,
    }), studio);
  }

  private async packageExpiring(
    studioId: string,
    studio: StudioInfo,
    daysBefore: number | undefined,
    unitsAtMost: number | undefined,
    now: Date,
    enrolled: string[],
  ): Promise<ScannedCandidate[]> {
    const or: Prisma.MemberPackageWhereInput[] = [];
    if (daysBefore !== undefined) or.push({ endDate: { gte: now, lte: new Date(now.getTime() + daysBefore * DAY_MS) } });
    if (unitsAtMost !== undefined) or.push({ remainingUnits: { not: null, lte: unitsAtMost } });
    if (!or.length) return [];
    const packages = await this.prisma.memberPackage.findMany({
      where: { studioId, status: 'ACTIVE', id: { notIn: enrolled }, OR: or, member: { membership: { status: 'ACTIVE', isPartnerGuest: false } } },
      select: { id: true, endDate: true, remainingUnits: true, packageDefinition: { select: { name: true } }, member: { select: memberSelect } },
      orderBy: [{ endDate: 'asc' }, { id: 'asc' }],
      take: SCAN_LIMIT,
    });
    return this.toCandidates(studioId, packages, (p, locale) => ({
      ref: p.id,
      occurredAt: now,
      variables: {
        packageName: p.packageDefinition.name,
        remainingUnits: p.remainingUnits === null ? unlimited(locale) : String(p.remainingUnits),
        expiryDate: formatDateTime(p.endDate, locale, studio.timezone),
      },
      targetRef: p.id,
    }), studio);
  }

  private async packageExpired(studioId: string, studio: StudioInfo, now: Date, floor: Date, enrolled: string[]): Promise<ScannedCandidate[]> {
    const packages = await this.prisma.memberPackage.findMany({
      where: {
        studioId,
        id: { notIn: enrolled },
        status: { in: ['ACTIVE', 'EXPIRED'] },
        endDate: { gte: floor, lte: now },
        member: { membership: { status: 'ACTIVE', isPartnerGuest: false } },
      },
      select: { id: true, endDate: true, packageDefinition: { select: { name: true } }, member: { select: memberSelect } },
      orderBy: [{ endDate: 'desc' }, { id: 'asc' }],
      take: SCAN_LIMIT,
    });
    return this.toCandidates(studioId, packages, (p, locale) => ({
      ref: p.id,
      occurredAt: p.endDate,
      variables: { packageName: p.packageDefinition.name, expiryDate: formatDateTime(p.endDate, locale, studio.timezone) },
      targetRef: p.id,
    }), studio);
  }

  private async birthday(studioId: string, studio: StudioInfo, daysBefore: number, now: Date, journeyId: string | undefined): Promise<ScannedCandidate[]> {
    const target = localMonthDay(new Date(now.getTime() + daysBefore * DAY_MS), studio.timezone);
    const year = localMonthDay(now, studio.timezone).year;
    const ref = `birthday:${year}`;
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT mp."id"::text AS id
      FROM "member_profiles" mp
      JOIN "memberships" m ON m."id" = mp."membership_id"
      WHERE mp."studio_id" = ${studioId}::uuid
        AND mp."birth_date" IS NOT NULL
        AND date_part('month', mp."birth_date") = ${target.month}
        AND date_part('day', mp."birth_date") = ${target.day}
        AND m."status" = 'ACTIVE' AND m."is_partner_guest" = false
        AND NOT EXISTS (
          SELECT 1 FROM "journey_enrollments" je
          JOIN "contacts" c ON c."id" = je."contact_id"
          WHERE ${journeyId ?? null}::uuid IS NOT NULL AND je."journey_id" = ${journeyId ?? null}::uuid
            AND je."trigger_ref" = ${ref} AND c."membership_id" = m."id")
      ORDER BY mp."id" DESC
      LIMIT ${SCAN_LIMIT}`;
    if (!rows.length) return [];
    const profiles = await this.prisma.memberProfile.findMany({
      where: { id: { in: rows.map((r) => r.id) }, studioId },
      select: memberSelect,
    });
    return this.toCandidates(studioId, profiles.map((p) => ({ member: p })), (p) => ({
      ref,
      occurredAt: now,
      variables: {},
      targetRef: `${p.member.id}:${year}`,
    }), studio);
  }

  private async noShows(studioId: string, studio: StudioInfo, now: Date, floor: Date, enrolled: string[]): Promise<ScannedCandidate[]> {
    const bookings = await this.prisma.booking.findMany({
      where: { studioId, status: 'NO_SHOW', id: { notIn: enrolled }, schedule: { startTime: { gte: floor, lte: now } } },
      select: { id: true, member: { select: memberSelect }, schedule: { select: { startTime: true, title: true, serviceType: { select: { name: true } } } } },
      orderBy: [{ schedule: { startTime: 'desc' } }, { id: 'asc' }],
      take: SCAN_LIMIT,
    });
    return this.toCandidates(studioId, bookings, (b, locale) => ({
      ref: b.id,
      occurredAt: b.schedule.startTime,
      variables: { serviceName: b.schedule.serviceType?.name ?? b.schedule.title, startTime: formatDateTime(b.schedule.startTime, locale, studio.timezone) },
      targetRef: b.id,
    }), studio);
  }

  private async attended(studioId: string, studio: StudioInfo, now: Date, floor: Date, enrolled: string[]): Promise<ScannedCandidate[]> {
    const bookings = await this.prisma.booking.findMany({
      where: { studioId, status: 'ATTENDED', id: { notIn: enrolled }, checkInAt: { gte: floor, lte: now } },
      select: { id: true, checkInAt: true, member: { select: memberSelect }, schedule: { select: { title: true, serviceType: { select: { name: true } } } } },
      orderBy: [{ checkInAt: 'desc' }, { id: 'asc' }],
      take: SCAN_LIMIT,
    });
    return this.toCandidates(studioId, bookings, (b) => ({
      ref: b.id,
      occurredAt: b.checkInAt ?? now,
      variables: { serviceName: b.schedule.serviceType?.name ?? b.schedule.title },
      targetRef: b.id,
    }), studio);
  }

  private async firstAttended(studioId: string, studio: StudioInfo, now: Date, floor: Date, journeyId: string | undefined): Promise<ScannedCandidate[]> {
    const firsts = await this.prisma.$queryRaw<{ id: string; check_in_at: Date }[]>`
      SELECT f."id"::text AS id, f."check_in_at"
      FROM (
        SELECT DISTINCT ON (b."member_id") b."id", b."check_in_at"
        FROM "bookings" b
        WHERE b."studio_id" = ${studioId}::uuid AND b."status" = 'ATTENDED' AND b."check_in_at" IS NOT NULL
        ORDER BY b."member_id", b."check_in_at" ASC
      ) f
      WHERE f."check_in_at" >= ${floor} AND f."check_in_at" <= ${now}
        AND NOT EXISTS (
          SELECT 1 FROM "journey_enrollments" je
          WHERE ${journeyId ?? null}::uuid IS NOT NULL AND je."journey_id" = ${journeyId ?? null}::uuid
            AND je."trigger_ref" = f."id"::text)
      ORDER BY f."check_in_at" DESC
      LIMIT ${SCAN_LIMIT}`;
    if (!firsts.length) return [];
    const bookings = await this.prisma.booking.findMany({
      where: { id: { in: firsts.map((f) => f.id) }, studioId },
      select: { id: true, checkInAt: true, member: { select: memberSelect } },
    });
    return this.toCandidates(studioId, bookings, (b) => ({ ref: b.id, occurredAt: b.checkInAt ?? now, variables: {}, targetRef: b.id }), studio);
  }

  private async churnHigh(studioId: string, now: Date, floor: Date, journeyId: string | undefined): Promise<ScannedCandidate[]> {
    const month = now.toISOString().slice(0, 7);
    const ref = `churn_high:${month}`;
    const snapshots = await this.prisma.memberRiskSnapshot.findMany({
      where: {
        studioId,
        level: 'HIGH',
        computedAt: { gte: floor, lte: now },
        member: {
          membership: {
            isPartnerGuest: false,
            ...(journeyId
              ? { OR: [{ contact: { is: null } }, { contact: { is: { journeyEnrollments: { none: { journeyId, triggerRef: ref } } } } }] }
              : {}),
          },
        },
      },
      select: { computedAt: true, member: { select: memberSelect } },
      orderBy: [{ computedAt: 'desc' }, { id: 'asc' }],
      take: SCAN_LIMIT,
    });
    return this.toCandidates(studioId, snapshots, (s) => ({ ref, occurredAt: s.computedAt, variables: {}, targetRef: `churn:${month}` }), {
      timezone: 'UTC',
      defaultLocale: 'tr',
    });
  }

  // ---------------------------------------------------------------------------

  /** Maps member rows to their contacts (creating missing contacts like the CRM hooks do). */
  private async toCandidates<T extends { member: MemberSelected }>(
    studioId: string,
    rows: T[],
    build: (row: T, locale: string) => { ref: string; occurredAt: Date; variables: Record<string, string>; targetRef: string },
    studio: StudioInfo,
  ): Promise<ScannedCandidate[]> {
    if (!rows.length) return [];
    const membershipIds = [...new Set(rows.map((r) => r.member.membershipId))];
    const contacts = await this.prisma.contact.findMany({
      where: { studioId, membershipId: { in: membershipIds }, mergedIntoId: null },
      select: { id: true, membershipId: true, locale: true },
    });
    const byMembership = new Map(contacts.map((c) => [c.membershipId as string, c]));
    const out: ScannedCandidate[] = [];
    for (const row of rows) {
      let contact = byMembership.get(row.member.membershipId);
      if (!contact) {
        const created = await this.crm.ensureContactForMembership(studioId, row.member.membershipId);
        if (!created) continue;
        contact = { id: created.id, membershipId: created.membershipId, locale: created.locale };
        byMembership.set(row.member.membershipId, contact);
      }
      const locale = contact.locale ?? row.member.membership.user.locale ?? studio.defaultLocale;
      const built = build(row, locale);
      out.push({
        contactId: contact.id,
        ref: built.ref,
        occurredAt: built.occurredAt,
        variables: built.variables,
        legacy: { userId: row.member.membership.userId, targetRef: built.targetRef },
      });
    }
    return out;
  }
}

const memberSelect = {
  id: true,
  membershipId: true,
  membership: { select: { userId: true, isPartnerGuest: true, user: { select: { locale: true } } } },
} satisfies Prisma.MemberProfileSelect;
type MemberSelected = Prisma.MemberProfileGetPayload<{ select: typeof memberSelect }>;

function unlimited(locale: string): string {
  const t = createTranslator({ locale, messages: BUNDLED_MESSAGES[locale] ?? BASE_MESSAGES, fallback: BASE_MESSAGES });
  return t('journeys.var.unlimited');
}
