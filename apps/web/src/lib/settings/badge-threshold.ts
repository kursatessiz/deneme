import { BadgeKind } from '@platform/shared';
import type { BadgeThresholdParams } from '@platform/shared';
import type { Translate } from '@platform/shared';

/** Label for the badge kind selector; call with the active `useT()`/`getT()` translator. */
export function badgeKindLabel(t: Translate, kind: BadgeKind): string {
  return t(`settings.badges.kind.${kind}`);
}

/** A sensible default threshold for a freshly chosen badge kind, so the form always has a valid value. */
export function defaultThresholdFor(kind: BadgeKind): BadgeThresholdParams {
  switch (kind) {
    case BadgeKind.MILESTONE_SESSIONS:
      return { kind, sessions: 10 };
    case BadgeKind.STREAK_WEEKS:
      return { kind, weeks: 4, minSessionsPerWeek: 1 };
    case BadgeKind.MONTHLY_GOAL_MET:
      return { kind };
    case BadgeKind.FIRST_SESSION:
      return { kind };
    case BadgeKind.EARLY_BIRD:
      return { kind, beforeHour: 8 };
    case BadgeKind.VARIETY:
      return { kind, distinctServiceTypes: 3 };
    default: {
      // Exhaustiveness guard only: unreachable for any value TypeScript allows through.
      const _exhaustive: never = kind;
      throw new Error(`Unknown badge kind: ${String(_exhaustive)}`);
    }
  }
}

/** Human-readable one-line summary of a threshold, for the badge list; call with the active translator. */
export function describeThreshold(t: Translate, threshold: BadgeThresholdParams): string {
  switch (threshold.kind) {
    case BadgeKind.MILESTONE_SESSIONS:
      return t('settings.badges.threshold.sessions', { count: threshold.sessions });
    case BadgeKind.STREAK_WEEKS:
      return t('settings.badges.threshold.streak', { weeks: threshold.weeks, minPerWeek: threshold.minSessionsPerWeek });
    case BadgeKind.MONTHLY_GOAL_MET:
      return t('settings.badges.threshold.monthlyGoal');
    case BadgeKind.FIRST_SESSION:
      return t('settings.badges.threshold.firstSession');
    case BadgeKind.EARLY_BIRD:
      return t('settings.badges.threshold.earlyBird', { hour: String(threshold.beforeHour).padStart(2, '0') });
    case BadgeKind.VARIETY:
      return t('settings.badges.threshold.variety', { count: threshold.distinctServiceTypes });
    default: {
      const _exhaustive: never = threshold;
      return String(_exhaustive);
    }
  }
}
