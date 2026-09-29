import { Prisma } from '@platform/database';
import { FUNNEL_GROUP_DIRECT, FUNNEL_GROUP_NONE, FUNNEL_STAGE_STEP_PREFIX, FUNNEL_VISIT_STEP } from '@platform/shared';
import type { FunnelAggregate, FunnelBreakdown, FunnelStepKey } from '@platform/shared';

/**
 * The funnel query (G5d-1, docs/HUNILER.md): one statement per report, the
 * counting and the medians done in PostgreSQL with CTEs, no per-contact
 * round trips. It follows the rules of `resolveFunnelPath` in
 * @platform/shared: step 1 is the contact's earliest event of that step and
 * must fall inside [from, to]; every later step is the earliest event of its
 * type at or after the previous step's moment (and within `windowDays` of it,
 * when set). Every value is a bound parameter; only the number of steps
 * (2-6, validated by the shared schema) shapes the SQL text.
 */

export interface FunnelSqlInput {
  studioId: string;
  steps: readonly FunnelStepKey[];
  windowDays: number | null;
  from: Date;
  to: Date;
  breakdown: FunnelBreakdown | null;
  /** Explicit branch filter (already checked against the caller's branches). */
  branchId?: string;
  /** The caller's branch restriction; null means every branch. Contacts without a branch stay visible. */
  branchIds: readonly string[] | null;
}

const raw = (text: string) => Prisma.raw(text);

function contactFilter(input: FunnelSqlInput): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`c.studio_id = ${input.studioId}::uuid`, Prisma.sql`c.is_test = false`, Prisma.sql`c.merged_into_id IS NULL`];
  if (input.branchId) {
    parts.push(Prisma.sql`c.branch_id = ${input.branchId}::uuid`);
  } else if (input.branchIds !== null) {
    parts.push(Prisma.sql`(c.branch_id IS NULL OR c.branch_id = ANY(${[...input.branchIds]}::uuid[]))`);
  }
  return Prisma.join(parts, ' AND ');
}

function breakdownExpressions(breakdown: FunnelBreakdown): { key: Prisma.Sql; label: Prisma.Sql } {
  switch (breakdown) {
    case 'source':
      return { key: Prisma.sql`COALESCE(NULLIF(c.first_source, ''), ${FUNNEL_GROUP_DIRECT}::text)`, label: Prisma.sql`NULL::text` };
    case 'campaign':
      return {
        key: Prisma.sql`COALESCE(NULLIF(c.first_campaign_id, ''), NULLIF(c.first_campaign_name, ''), ${FUNNEL_GROUP_NONE}::text)`,
        label: Prisma.sql`NULLIF(c.first_campaign_name, '')`,
      };
    case 'branch':
      return {
        key: Prisma.sql`COALESCE(c.branch_id::text, ${FUNNEL_GROUP_NONE}::text)`,
        label: Prisma.sql`b.name`,
      };
  }
}

export function buildFunnelSql(input: FunnelSqlInput): Prisma.Sql {
  const n = input.steps.length;
  const filter = contactFilter(input);
  const windowCond = (prev: number) =>
    input.windowDays === null ? Prisma.empty : Prisma.sql` AND e.occurred_at <= p.t${raw(String(prev))} + make_interval(days => ${input.windowDays}::int)`;

  const visitIndex = input.steps.indexOf(FUNNEL_VISIT_STEP) + 1;
  const visitBranch =
    visitIndex > 0
      ? Prisma.sql`
        UNION ALL
        SELECT t.contact_id, ${visitIndex}::int AS step, MIN(t.occurred_at) AS occurred_at
        FROM touchpoints t
        JOIN contacts c ON c.id = t.contact_id
        WHERE t.studio_id = ${input.studioId}::uuid AND t.contact_id IS NOT NULL AND ${filter}
        GROUP BY t.contact_id`
      : Prisma.empty;

  // Stage pseudo steps (`stage:<key>`): the contact's first move onto that pipeline stage, from its STAGE_CHANGE activities.
  const hasStageStep = input.steps.some((step) => step.startsWith(FUNNEL_STAGE_STEP_PREFIX));
  const stageBranch = hasStageStep
    ? Prisma.sql`
        UNION ALL
        SELECT ca.contact_id, s.idx::int AS step, MIN(ca.created_at) AS occurred_at
        FROM contact_activities ca
        JOIN unnest(${[...input.steps]}::text[]) WITH ORDINALITY AS s(type, idx) ON s.type = ${FUNNEL_STAGE_STEP_PREFIX}::text || (ca.metadata ->> 'to')
        JOIN contacts c ON c.id = ca.contact_id
        WHERE ca.studio_id = ${input.studioId}::uuid AND ca.type = 'STAGE_CHANGE' AND ${filter}
        GROUP BY ca.contact_id, s.idx`
    : Prisma.empty;

  const ctes: Prisma.Sql[] = [
    Prisma.sql`ev AS (
        SELECT ce.contact_id, s.idx::int AS step, ce.occurred_at
        FROM conversion_events ce
        JOIN unnest(${[...input.steps]}::text[]) WITH ORDINALITY AS s(type, idx) ON s.type = ce.type
        JOIN contacts c ON c.id = ce.contact_id
        WHERE ce.studio_id = ${input.studioId}::uuid AND ce.is_test = false AND ${filter}
        ${visitBranch}
        ${stageBranch}
      )`,
    Prisma.sql`p1 AS (
        SELECT contact_id, MIN(occurred_at) AS t1
        FROM ev
        WHERE step = 1
        GROUP BY contact_id
        HAVING MIN(occurred_at) >= ${input.from.toISOString()}::timestamp AND MIN(occurred_at) <= ${input.to.toISOString()}::timestamp
      )`,
  ];

  for (let k = 2; k <= n; k++) {
    const carried = Array.from({ length: k - 1 }, (_, i) => `p.t${i + 1}`).join(', ');
    ctes.push(
      Prisma.sql`p${raw(String(k))} AS (
        SELECT p.contact_id, ${raw(carried)}, MIN(e.occurred_at) AS t${raw(String(k))}
        FROM p${raw(String(k - 1))} p
        LEFT JOIN ev e ON e.contact_id = p.contact_id AND e.step = ${k}::int AND p.t${raw(String(k - 1))} IS NOT NULL AND e.occurred_at >= p.t${raw(String(k - 1))}${windowCond(k - 1)}
        GROUP BY p.contact_id, ${raw(carried)}
      )`,
    );
  }

  const pathColumns = Array.from({ length: n }, (_, i) => `p.t${i + 1}`).join(', ');
  const bd = input.breakdown ? breakdownExpressions(input.breakdown) : null;
  ctes.push(
    bd
      ? Prisma.sql`paths AS (
        SELECT p.contact_id, ${raw(pathColumns)}, ${bd.key} AS bkey, ${bd.label} AS blabel
        FROM p${raw(String(n))} p
        JOIN contacts c ON c.id = p.contact_id
        ${input.breakdown === 'branch' ? Prisma.sql`LEFT JOIN branches b ON b.id = c.branch_id` : Prisma.empty}
      )`
      : Prisma.sql`paths AS (SELECT p.contact_id, ${raw(pathColumns)}, NULL::text AS bkey, NULL::text AS blabel FROM p${raw(String(n))} p)`,
  );

  const counts = Array.from({ length: n }, (_, i) => `COUNT(t${i + 1})::int AS c${i + 1}`).join(', ');
  const medians = Array.from(
    { length: n - 1 },
    (_, i) => `percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (t${i + 2} - t${i + 1}))::double precision) AS m${i + 2}`,
  ).join(', ');

  const select = bd
    ? Prisma.sql`SELECT GROUPING(bkey)::int AS is_total, bkey, MIN(blabel) AS label, ${raw(counts)}, ${raw(medians)} FROM paths GROUP BY GROUPING SETS ((), (bkey))`
    : Prisma.sql`SELECT 1::int AS is_total, NULL::text AS bkey, NULL::text AS label, ${raw(counts)}, ${raw(medians)} FROM paths`;

  return Prisma.sql`WITH ${Prisma.join(ctes, ', ')} ${select}`;
}

export interface FunnelSqlGroup {
  /** Null for the whole-funnel total row. */
  key: string | null;
  label: string | null;
  aggregate: FunnelAggregate;
}

/** Reads the rows of `buildFunnelSql` (numbers arrive as int or double, medians may be null). */
export function parseFunnelRows(rows: readonly Record<string, unknown>[], stepCount: number): FunnelSqlGroup[] {
  return rows.map((row) => {
    const counts: number[] = [];
    const medianSeconds: (number | null)[] = [null];
    for (let k = 1; k <= stepCount; k++) {
      counts.push(Number(row[`c${k}`] ?? 0));
      if (k > 1) {
        const m = row[`m${k}`];
        medianSeconds.push(m === null || m === undefined ? null : Number(m));
      }
    }
    const isTotal = Number(row.is_total) === 1;
    return {
      key: isTotal ? null : String(row.bkey ?? ''),
      label: typeof row.label === 'string' ? row.label : null,
      aggregate: { counts, medianSeconds },
    };
  });
}
