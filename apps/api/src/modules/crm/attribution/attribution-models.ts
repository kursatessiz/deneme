import { ATTRIBUTION_DIRECT, ATTRIBUTION_NONE } from '@platform/shared';
import type { AttributionGroupBy, AttributionModel } from '@platform/shared';

/**
 * Pure attribution logic: which touchpoint(s) get the credit for a
 * conversion, and under which report key. No database access here so the
 * rules are unit tested in isolation (attribution-models.spec.ts).
 */

export interface TouchLike {
  id: string;
  occurredAt: Date;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmId: string | null;
  pwCid: string | null;
  pwAsid: string | null;
  pwAdid: string | null;
  adPlatform: string | null;
  referrerHost: string | null;
}

/** First/last attribution summary kept on Contact for fast reporting. */
export interface TouchSummary {
  source: string | null;
  medium: string | null;
  campaignName: string | null;
  campaignId: string | null;
  adsetId: string | null;
  adId: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Source label of a touch: utm_source, else the detected ad platform, else the referring host, else direct. */
export function touchSource(t: TouchLike): string {
  return t.utmSource ?? (t.adPlatform ? t.adPlatform.toLowerCase() : null) ?? t.referrerHost ?? ATTRIBUTION_DIRECT;
}

export function touchSummary(t: TouchLike): TouchSummary {
  return {
    source: touchSource(t),
    medium: t.utmMedium,
    campaignName: t.utmCampaign,
    campaignId: t.pwCid ?? t.utmId,
    adsetId: t.pwAsid,
    adId: t.pwAdid,
  };
}

export function groupKeyOfSummary(s: TouchSummary, groupBy: AttributionGroupBy): string {
  switch (groupBy) {
    case 'source':
      return s.source ?? ATTRIBUTION_DIRECT;
    case 'campaign':
      return s.campaignId ?? s.campaignName ?? ATTRIBUTION_NONE;
    case 'adset':
      return s.adsetId ?? ATTRIBUTION_NONE;
    case 'ad':
      return s.adId ?? ATTRIBUTION_NONE;
  }
}

export function groupKeyOfTouch(t: TouchLike, groupBy: AttributionGroupBy): string {
  return groupKeyOfSummary(touchSummary(t), groupBy);
}

/** Touches at or before `at` and no older than the window, oldest first. */
export function touchesInWindow<T extends TouchLike>(touches: readonly T[], at: Date, windowDays: number): T[] {
  const from = at.getTime() - windowDays * DAY_MS;
  return touches
    .filter((t) => t.occurredAt.getTime() <= at.getTime() && t.occurredAt.getTime() >= from)
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
}

/** Most recent touch before `at` within the window, or null (direct / expired). */
export function pickLastTouch<T extends TouchLike>(touches: readonly T[], at: Date, windowDays: number): T | null {
  const inWindow = touchesInWindow(touches, at, windowDays);
  return inWindow.length > 0 ? inWindow[inWindow.length - 1] : null;
}

/** Earliest touch at or before `at` (no window: first touch is first touch). */
export function pickFirstTouch<T extends TouchLike>(touches: readonly T[], at: Date): T | null {
  let first: T | null = null;
  for (const t of touches) {
    if (t.occurredAt.getTime() > at.getTime()) continue;
    if (!first || t.occurredAt.getTime() < first.occurredAt.getTime()) first = t;
  }
  return first;
}

export interface CreditInput {
  /** Every touchpoint attached to the contact (any order). */
  touches: readonly TouchLike[];
  at: Date;
  windowDays: number;
  /**
   * Summary columns on the contact. Used when the contact has no
   * touchpoints at all (e.g. migrated leads with hand-entered UTM values).
   */
  firstSummary: TouchSummary | null;
  lastSummary: TouchSummary | null;
}

export interface Credit {
  key: string;
  weight: number;
}

/**
 * Splits one conversion's credit across report keys.
 * FIRST_TOUCH: the contact's earliest touch gets 1.
 * LAST_TOUCH: the latest touch within the window gets 1.
 * LINEAR: every touch within the window gets an equal share.
 * Without a qualifying touch the conversion counts as direct, except for
 * contacts that never had a touchpoint, which fall back to their summary.
 */
export function creditConversion(model: AttributionModel, input: CreditInput, groupBy: AttributionGroupBy): Credit[] {
  const fallback = (summary: TouchSummary | null): Credit[] => {
    if (input.touches.length === 0 && summary && hasAnySummary(summary)) {
      return [{ key: groupKeyOfSummary(summary, groupBy), weight: 1 }];
    }
    return [{ key: groupBy === 'source' ? ATTRIBUTION_DIRECT : ATTRIBUTION_NONE, weight: 1 }];
  };

  if (model === 'FIRST_TOUCH') {
    const first = pickFirstTouch(input.touches, input.at);
    return first ? [{ key: groupKeyOfTouch(first, groupBy), weight: 1 }] : fallback(input.firstSummary);
  }
  if (model === 'LAST_TOUCH') {
    const last = pickLastTouch(input.touches, input.at, input.windowDays);
    return last ? [{ key: groupKeyOfTouch(last, groupBy), weight: 1 }] : fallback(input.lastSummary);
  }
  const inWindow = touchesInWindow(input.touches, input.at, input.windowDays);
  if (inWindow.length === 0) return fallback(input.lastSummary);
  const weight = 1 / inWindow.length;
  const byKey = new Map<string, number>();
  for (const t of inWindow) {
    const key = groupKeyOfTouch(t, groupBy);
    byKey.set(key, (byKey.get(key) ?? 0) + weight);
  }
  return [...byKey.entries()].map(([key, w]) => ({ key, weight: w }));
}

function hasAnySummary(s: TouchSummary): boolean {
  return Boolean(s.source || s.campaignId || s.campaignName || s.adsetId || s.adId);
}
