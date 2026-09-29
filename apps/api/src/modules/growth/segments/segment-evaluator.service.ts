import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@platform/database';
import {
  SegmentGroupSchema,
  UNAVAILABLE_SEGMENT_FIELDS,
  normalizeTag,
  segmentFieldKind,
  validateSegmentRules,
} from '@platform/shared';
import type { SegmentCondition, SegmentFieldKind, SegmentGroup } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

type Scalar = string | number | boolean;
type Where = Prisma.ContactWhereInput;

/** Fixed SQL comparison operators, keyed by DSL operator; the only text that ever reaches Prisma.raw. */
const SQL_COMPARATORS: Readonly<Record<string, string>> = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };

export interface SegmentEvaluationContext {
  studioId: string;
  now: Date;
  /** Tenant custom field key -> kind (ContactFieldDefinition). */
  customFieldKinds: Record<string, SegmentFieldKind>;
}

/**
 * Compiles the segment rule language (packages/shared growth/segments.ts)
 * into a Prisma `where` over Contact. Contact columns, tags, custom fields
 * and every "has / has not" question about memberships, bookings, packages,
 * payments and churn snapshots become Prisma relation filters. The
 * aggregate questions Prisma cannot express (counts, sums, days until a
 * birthday, custom dates) run as parameterised tagged-template queries that
 * return the matching contact ids of this studio only; operator text comes
 * from SQL_COMPARATORS, never from the rule. The studio filter and the
 * "not merged" filter are always applied by the caller-facing methods.
 */
@Injectable()
export class SegmentEvaluatorService {
  constructor(private readonly prisma: PrismaService) {}

  /** Field kinds of the tenant's custom fields (archived ones included, so old rules stay valid). */
  async customFieldKinds(studioId: string): Promise<Record<string, SegmentFieldKind>> {
    const defs = await this.prisma.contactFieldDefinition.findMany({ where: { studioId }, select: { key: true, kind: true } });
    return Object.fromEntries(defs.map((d) => [d.key, d.kind as SegmentFieldKind]));
  }

  /** Parses and validates untrusted rule JSON; throws 400 with every issue. */
  async validate(studioId: string, raw: unknown): Promise<SegmentGroup> {
    const parsed = SegmentGroupSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Geçersiz segment kuralı',
        errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const kinds = await this.customFieldKinds(studioId);
    const issues = validateSegmentRules(parsed.data, kinds);
    const unavailable = collectFields(parsed.data)
      .filter((f) => f in UNAVAILABLE_SEGMENT_FIELDS)
      .map((f) => ({ path: 'root', message: UNAVAILABLE_SEGMENT_FIELDS[f as keyof typeof UNAVAILABLE_SEGMENT_FIELDS] as string }));
    const all = [...issues, ...unavailable];
    if (all.length) throw new BadRequestException({ message: 'Geçersiz segment kuralı', errors: all });
    return parsed.data;
  }

  /** The full contact filter for a rule set: studio, unmerged, and the compiled rules. */
  async where(studioId: string, rules: SegmentGroup, now = new Date()): Promise<Where> {
    const ctx: SegmentEvaluationContext = { studioId, now, customFieldKinds: await this.customFieldKinds(studioId) };
    return { studioId, mergedIntoId: null, AND: [await this.compileGroup(rules, ctx)] };
  }

  async count(studioId: string, rules: SegmentGroup, now = new Date()): Promise<number> {
    return this.prisma.contact.count({ where: await this.where(studioId, rules, now) });
  }

  /** Every matching contact id (bounded by the tenant's contact count). */
  async contactIds(studioId: string, rules: SegmentGroup, now = new Date()): Promise<string[]> {
    const rows = await this.prisma.contact.findMany({ where: await this.where(studioId, rules, now), select: { id: true } });
    return rows.map((r) => r.id);
  }

  /** Whether one contact of this studio matches (journey branches, goals and trigger filters). */
  async matches(studioId: string, contactId: string, rules: SegmentGroup, now = new Date()): Promise<boolean> {
    const where = await this.where(studioId, rules, now);
    return (await this.prisma.contact.count({ where: { AND: [where, { id: contactId }] } })) > 0;
  }

  // ---------------------------------------------------------------------------
  // Compilation
  // ---------------------------------------------------------------------------

  async compileGroup(group: SegmentGroup, ctx: SegmentEvaluationContext): Promise<Where> {
    const parts: Where[] = [];
    for (const rule of group.rules) {
      parts.push('combinator' in rule ? await this.compileGroup(rule, ctx) : await this.compileCondition(rule, ctx));
    }
    return group.combinator === 'and' ? { AND: parts } : { OR: parts };
  }

  private async compileCondition(rule: SegmentCondition, ctx: SegmentEvaluationContext): Promise<Where> {
    const kind = segmentFieldKind(rule.field, ctx.customFieldKinds);
    if (!kind) throw new BadRequestException(`Bilinmeyen alan: ${rule.field}`);
    if (rule.field.startsWith('custom.')) return this.compileCustom(rule.field.slice('custom.'.length), kind, rule, ctx);

    const { now, studioId } = ctx;
    switch (rule.field) {
      case 'contact.lifecycleStage':
        return enumFilter(rule, (values) => ({ lifecycleStage: { in: values as Prisma.EnumContactLifecycleStageFilter['in'] } }));
      case 'contact.locale':
        return stringFilter('locale', rule);
      case 'contact.countryCode':
        return stringFilter('countryCode', rule, (v) => v.toUpperCase());
      case 'contact.ownerId':
        return stringFilter('ownerMembershipId', rule);
      case 'contact.homeBranchId':
        return stringFilter('branchId', rule);
      case 'attribution.firstSource':
        return stringFilter('firstSource', rule);
      case 'attribution.firstCampaignId':
        return stringFilter('firstCampaignId', rule);
      case 'attribution.lastSource':
        return stringFilter('lastSource', rule);
      case 'contact.createdAt':
        return dateFilter(rule, now, (range) => ({ createdAt: range }));
      case 'contact.tags': {
        const tags = list(rule.value)
          .map((v) => normalizeTag(String(v)))
          .filter((t): t is string => Boolean(t));
        if (rule.op === 'has_any') return { tags: { hasSome: tags } };
        if (rule.op === 'has_all') return { tags: { hasEvery: tags } };
        return { NOT: { tags: { hasSome: tags } } };
      }
      case 'consent.commercialAllowed': {
        const granted: Where = {
          OR: [
            // M3e: a form consent waiting for its double opt-in confirmation does not count yet.
            { consents: { some: { status: 'GRANTED', OR: [{ confirmationRequestedAt: null }, { confirmedAt: { not: null } }] } } },
            { membership: { is: { user: { communicationConsents: { some: { studioId, status: 'GRANTED' } } } } } },
          ],
        };
        return rule.op === 'is_true' ? granted : { NOT: granted };
      }
      case 'activity.lastAttendedDaysAgo':
        return relativeDaysAgo(rule, now, (range) => memberHas({ bookings: { some: { status: 'ATTENDED', schedule: { startTime: range } } } }));
      case 'payment.lastPaidDaysAgo':
        return relativeDaysAgo(rule, now, (range) => memberHas({ payments: { some: { paymentStatus: 'COMPLETED', paidAt: range } } }));
      case 'package.hasActive': {
        const active = memberHas({ packages: { some: { status: 'ACTIVE', endDate: { gt: now } } } });
        return rule.op === 'is_true' ? active : { NOT: active };
      }
      case 'package.expiresInDays':
        return this.packageExpiry(rule, now);
      case 'package.remainingUnits': {
        const filter = numberRange(rule);
        return memberHas({ packages: { some: { status: 'ACTIVE', endDate: { gt: now }, remainingUnits: { not: null, ...filter.range } } } }, filter.negate);
      }
      case 'churn.riskLevel': {
        const levels = list(rule.value).map(String) as Prisma.EnumChurnRiskLevelFilter['in'];
        const inLevels = memberHas({ riskSnapshot: { is: { level: { in: levels } } } });
        return rule.op === 'in' ? inLevels : { NOT: inLevels };
      }
      case 'activity.attendedLast30Days':
        return this.idsWhere(await this.aggregateIds(ctx, 'attended30', rule));
      case 'activity.attendedTotal':
        return this.idsWhere(await this.aggregateIds(ctx, 'attendedTotal', rule));
      case 'activity.noShowsLast30Days':
        return this.idsWhere(await this.aggregateIds(ctx, 'noShows30', rule));
      case 'payment.totalSpent':
        return this.idsWhere(await this.aggregateIds(ctx, 'totalSpent', rule));
      case 'contact.birthdayInDays':
        return this.idsWhere(await this.aggregateIds(ctx, 'birthdayInDays', rule));
      case 'loyalty.pointsBalance':
        return this.idsWhere(await this.aggregateIds(ctx, 'loyaltyBalance', rule));
      default: {
        const reason = UNAVAILABLE_SEGMENT_FIELDS[rule.field as keyof typeof UNAVAILABLE_SEGMENT_FIELDS];
        throw new BadRequestException(reason ?? `Bu alan henüz desteklenmiyor: ${rule.field}`);
      }
    }
  }

  private packageExpiry(rule: SegmentCondition, now: Date): Where {
    const at = (days: number) => new Date(now.getTime() + days * DAY_MS);
    const activeWith = (endDate: Prisma.DateTimeFilter) => memberHas({ packages: { some: { status: 'ACTIVE', endDate } } });
    const anyActive = activeWith({ gt: now });
    const values = list(rule.value).map(Number);
    switch (rule.op) {
      case 'lt':
        return activeWith({ gt: now, lt: at(values[0]) });
      case 'lte':
        return activeWith({ gt: now, lte: at(values[0]) });
      case 'gt':
        return { AND: [anyActive, { NOT: activeWith({ gt: now, lte: at(values[0]) }) }] };
      case 'gte':
        return { AND: [anyActive, { NOT: activeWith({ gt: now, lt: at(values[0]) }) }] };
      case 'between':
        return activeWith({ gte: at(Math.min(values[0], values[1])), lte: at(Math.max(values[0], values[1])) });
      case 'is_empty':
        return { NOT: anyActive };
      default:
        throw new BadRequestException(`Geçersiz işlem: ${rule.op}`);
    }
  }

  private compileCustom(key: string, kind: SegmentFieldKind, rule: SegmentCondition, ctx: SegmentEvaluationContext): Promise<Where> | Where {
    const path = [key];
    const equals = (v: Scalar): Where => ({ customFields: { path, equals: v } });
    switch (kind) {
      case 'string': {
        if (rule.op === 'eq') return equals(String(rule.value));
        if (rule.op === 'neq') return { NOT: equals(String(rule.value)) };
        if (rule.op === 'in') return { OR: list(rule.value).map((v) => equals(String(v))) };
        if (rule.op === 'not_in') return { NOT: { OR: list(rule.value).map((v) => equals(String(v))) } };
        if (rule.op === 'contains') return { customFields: { path, string_contains: String(rule.value) } };
        const hasText: Where = { AND: [{ customFields: { path, string_contains: '' } }, { NOT: equals('') }] };
        return rule.op === 'is_empty' ? { NOT: hasText } : hasText;
      }
      case 'enum':
        return rule.op === 'in'
          ? { OR: list(rule.value).map((v) => equals(String(v))) }
          : { NOT: { OR: list(rule.value).map((v) => equals(String(v))) } };
      case 'boolean':
        return rule.op === 'is_true' ? equals(true) : { NOT: equals(true) };
      case 'number': {
        const values = list(rule.value).map(Number);
        switch (rule.op) {
          case 'eq':
            return equals(values[0]);
          case 'neq':
            return { NOT: equals(values[0]) };
          case 'gt':
            return { customFields: { path, gt: values[0] } };
          case 'gte':
            return { customFields: { path, gte: values[0] } };
          case 'lt':
            return { customFields: { path, lt: values[0] } };
          case 'lte':
            return { customFields: { path, lte: values[0] } };
          case 'between':
            return { AND: [{ customFields: { path, gte: Math.min(values[0], values[1]) } }, { customFields: { path, lte: Math.max(values[0], values[1]) } }] };
          default:
            throw new BadRequestException(`Geçersiz işlem: ${rule.op}`);
        }
      }
      case 'date':
        return this.customDateIds(ctx, key, rule).then((ids) => this.idsWhere(ids));
      default:
        throw new BadRequestException(`Bu alan türü segmentte kullanılamaz: ${kind}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Parameterised aggregate queries (studio scoped, contact ids out)
  // ---------------------------------------------------------------------------

  private idsWhere(ids: string[]): Where {
    return { id: { in: ids } };
  }

  private async aggregateIds(
    ctx: SegmentEvaluationContext,
    metric: 'attended30' | 'attendedTotal' | 'noShows30' | 'totalSpent' | 'birthdayInDays' | 'loyaltyBalance',
    rule: SegmentCondition,
  ): Promise<string[]> {
    const { studioId, now } = ctx;
    const since30 = new Date(now.getTime() - 30 * DAY_MS);
    let value: Prisma.Sql;
    switch (metric) {
      case 'attended30':
      case 'attendedTotal':
      case 'noShows30': {
        const status = metric === 'noShows30' ? 'NO_SHOW' : 'ATTENDED';
        const window = metric === 'attendedTotal' ? Prisma.empty : Prisma.sql`AND s."start_time" >= ${since30} AND s."start_time" <= ${now}`;
        value = Prisma.sql`(
          SELECT count(*)::float8 FROM "bookings" b
          JOIN "session_schedules" s ON s."id" = b."schedule_id"
          WHERE b."member_id" = mp."id" AND b."studio_id" = ${studioId}::uuid AND b."status"::text = ${status} ${window}
        )`;
        break;
      }
      case 'totalSpent':
        value = Prisma.sql`(
          SELECT COALESCE(sum(p."amount" - p."refunded_amount"), 0)::float8 FROM "payments" p
          WHERE p."member_id" = mp."id" AND p."studio_id" = ${studioId}::uuid AND p."payment_status" = 'COMPLETED'
        )`;
        break;
      case 'loyaltyBalance':
        // G3a: the cached balance of the contact's membership (0 without an account).
        value = Prisma.sql`(
          SELECT la."balance"::float8 FROM "loyalty_accounts" la
          WHERE la."membership_id" = c."membership_id" AND la."studio_id" = ${studioId}::uuid
        )`;
        break;
      case 'birthdayInDays': {
        // Days until the next birthday in the studio's calendar (0 on the day itself).
        const today = await this.studioToday(studioId, now);
        value = Prisma.sql`(
          CASE WHEN mp."birth_date" IS NULL THEN NULL ELSE
            ((mp."birth_date" + ((date_part('year', age(${today}::date - 1, mp."birth_date")) + 1) * interval '1 year'))::date - ${today}::date)::float8
          END
        )`;
        break;
      }
    }
    const condition = this.numericCondition(value, rule, metric === 'birthdayInDays');
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT c."id"::text AS id
      FROM "contacts" c
      LEFT JOIN "member_profiles" mp ON mp."membership_id" = c."membership_id"
      WHERE c."studio_id" = ${studioId}::uuid AND c."merged_into_id" IS NULL AND ${condition}`;
    return rows.map((r) => r.id);
  }

  /** `value <op> rule.value`; a null value (no member profile, no birth date) never matches except is_empty. */
  private numericCondition(value: Prisma.Sql, rule: SegmentCondition, nullableMetric: boolean): Prisma.Sql {
    const values = list(rule.value).map(Number);
    if (values.some((v) => !Number.isFinite(v))) throw new BadRequestException('Sayı bekleniyor');
    if (rule.op === 'between') {
      return Prisma.sql`${value} BETWEEN ${Math.min(values[0], values[1])} AND ${Math.max(values[0], values[1])}`;
    }
    const comparator = SQL_COMPARATORS[rule.op];
    if (!comparator) throw new BadRequestException(`Geçersiz işlem: ${rule.op}`);
    // Contacts without a member profile count as zero for counts and sums.
    const lhs = nullableMetric ? value : Prisma.sql`COALESCE(${value}, 0)`;
    return Prisma.sql`${lhs} ${Prisma.raw(comparator)} ${values[0]}`;
  }

  private async customDateIds(ctx: SegmentEvaluationContext, key: string, rule: SegmentCondition): Promise<string[]> {
    const { studioId, now } = ctx;
    const text = Prisma.sql`(c."custom_fields" ->> ${key})`;
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const values = list(rule.value).map(String);
    let condition: Prisma.Sql;
    switch (rule.op) {
      case 'before':
        condition = Prisma.sql`${text} < ${isoDate(values[0])}`;
        break;
      case 'after':
        condition = Prisma.sql`${text} > ${isoDate(values[0])}`;
        break;
      case 'between':
        condition = Prisma.sql`${text} BETWEEN ${isoDate(values[0])} AND ${isoDate(values[1])}`;
        break;
      case 'in_last_days':
        condition = Prisma.sql`${text} >= ${iso(new Date(now.getTime() - Number(values[0]) * DAY_MS))} AND ${text} <= ${iso(now)}`;
        break;
      case 'not_in_last_days':
        condition = Prisma.sql`${text} < ${iso(new Date(now.getTime() - Number(values[0]) * DAY_MS))}`;
        break;
      default:
        throw new BadRequestException(`Geçersiz işlem: ${rule.op}`);
    }
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT c."id"::text AS id FROM "contacts" c
      WHERE c."studio_id" = ${studioId}::uuid AND c."merged_into_id" IS NULL
        AND ${text} ~ '^\\d{4}-\\d{2}-\\d{2}$' AND ${condition}`;
    return rows.map((r) => r.id);
  }

  private async studioToday(studioId: string, now: Date): Promise<string> {
    const studio = await this.prisma.studio.findUnique({ where: { id: studioId }, select: { timezone: true } });
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: studio?.timezone ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    } catch {
      return now.toISOString().slice(0, 10);
    }
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function list(value: SegmentCondition['value']): Scalar[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function isoDate(raw: string): string {
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) throw new BadRequestException(`Geçersiz tarih: ${raw}`);
  return new Date(parsed).toISOString().slice(0, 10);
}

/** Contacts whose linked member profile satisfies `profile` (negate: all others, including contacts without one). */
function memberHas(profile: Prisma.MemberProfileWhereInput, negate = false): Where {
  const where: Where = { membership: { is: { memberProfile: { is: profile } } } };
  return negate ? { NOT: where } : where;
}

type StringColumn = 'locale' | 'countryCode' | 'ownerMembershipId' | 'branchId' | 'firstSource' | 'firstCampaignId' | 'lastSource';

function stringFilter(column: StringColumn, rule: SegmentCondition, normalize: (v: string) => string = (v) => v): Where {
  const values = list(rule.value).map((v) => normalize(String(v)));
  const col = (filter: Prisma.StringNullableFilter | null): Where => ({ [column]: filter }) as Where;
  switch (rule.op) {
    case 'eq':
      return col({ equals: values[0] });
    case 'neq':
      return { OR: [col({ not: values[0] }), col(null)] };
    case 'in':
      return col({ in: values });
    case 'not_in':
      return { OR: [col({ notIn: values }), col(null)] };
    case 'contains':
      return col({ contains: values[0], mode: 'insensitive' });
    case 'is_empty':
      return { OR: [col(null), col({ equals: '' })] };
    case 'is_not_empty':
      return { AND: [{ NOT: col(null) }, { NOT: col({ equals: '' }) }] };
    default:
      throw new BadRequestException(`Geçersiz işlem: ${rule.op}`);
  }
}

function enumFilter(rule: SegmentCondition, build: (values: string[]) => Where): Where {
  const values = list(rule.value).map(String);
  return rule.op === 'in' ? build(values) : { NOT: build(values) };
}

function dateFilter(rule: SegmentCondition, now: Date, build: (range: Prisma.DateTimeFilter) => Where): Where {
  const values = list(rule.value);
  const date = (v: Scalar) => {
    const parsed = typeof v === 'number' ? v : Date.parse(String(v));
    if (Number.isNaN(parsed)) throw new BadRequestException(`Geçersiz tarih: ${String(v)}`);
    return new Date(parsed);
  };
  switch (rule.op) {
    case 'before':
      return build({ lt: date(values[0]) });
    case 'after':
      return build({ gt: date(values[0]) });
    case 'between':
      return build({ gte: date(values[0]), lte: date(values[1]) });
    case 'in_last_days':
      return build({ gte: new Date(now.getTime() - Number(values[0]) * DAY_MS) });
    case 'not_in_last_days':
      return build({ lt: new Date(now.getTime() - Number(values[0]) * DAY_MS) });
    default:
      throw new BadRequestException(`Geçersiz işlem: ${rule.op}`);
  }
}

function numberRange(rule: SegmentCondition): { range: Prisma.IntNullableFilter; negate: boolean } {
  const values = list(rule.value).map(Number);
  switch (rule.op) {
    case 'eq':
      return { range: { equals: values[0] }, negate: false };
    case 'neq':
      return { range: { equals: values[0] }, negate: true };
    case 'gt':
      return { range: { gt: values[0] }, negate: false };
    case 'gte':
      return { range: { gte: values[0] }, negate: false };
    case 'lt':
      return { range: { lt: values[0] }, negate: false };
    case 'lte':
      return { range: { lte: values[0] }, negate: false };
    case 'between':
      return { range: { gte: Math.min(values[0], values[1]), lte: Math.max(values[0], values[1]) }, negate: false };
    default:
      throw new BadRequestException(`Geçersiz işlem: ${rule.op}`);
  }
}

/**
 * "Days since the last X" over a relation: `has(range)` answers whether an
 * X happened within `range`. lt/lte: one happened recently; gt/gte: at least
 * one ever and none recently; between [a, b]: the latest falls in the
 * window; is_empty: never.
 */
function relativeDaysAgo(rule: SegmentCondition, now: Date, has: (range: Prisma.DateTimeFilter) => Where): Where {
  const values = list(rule.value).map(Number);
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);
  const ever = has({ lte: now });
  switch (rule.op) {
    case 'lt':
      return has({ gt: ago(values[0]), lte: now });
    case 'lte':
      return has({ gte: ago(values[0]), lte: now });
    case 'gt':
      return { AND: [ever, { NOT: has({ gte: ago(values[0]), lte: now }) }] };
    case 'gte':
      return { AND: [ever, { NOT: has({ gt: ago(values[0]), lte: now }) }] };
    case 'between': {
      const low = Math.min(values[0], values[1]);
      const high = Math.max(values[0], values[1]);
      return { AND: [has({ gte: ago(high), lte: ago(low) }), { NOT: has({ gt: ago(low), lte: now }) }] };
    }
    case 'is_empty':
      return { NOT: ever };
    default:
      throw new BadRequestException(`Geçersiz işlem: ${rule.op}`);
  }
}

function collectFields(group: SegmentGroup): string[] {
  return group.rules.flatMap((rule) => ('combinator' in rule ? collectFields(rule) : [rule.field]));
}
