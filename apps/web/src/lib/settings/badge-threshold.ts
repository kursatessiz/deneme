import { BadgeKind } from '@platform/shared';
import type { BadgeThresholdParams } from '@platform/shared';

/** Labels for the badge kind selector. */
export const BADGE_KIND_LABELS: Record<BadgeKind, string> = {
  [BadgeKind.MILESTONE_SESSIONS]: 'Seans sayısı kilometre taşı',
  [BadgeKind.STREAK_WEEKS]: 'Haftalık seri',
  [BadgeKind.MONTHLY_GOAL_MET]: 'Aylık hedefe ulaşma',
  [BadgeKind.FIRST_SESSION]: 'İlk seans',
  [BadgeKind.EARLY_BIRD]: 'Erkenci',
  [BadgeKind.VARIETY]: 'Çeşitlilik',
};

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
      const _exhaustive: never = kind;
      throw new Error(`Bilinmeyen rozet türü: ${_exhaustive}`);
    }
  }
}

/** Human-readable one-line summary of a threshold, for the badge list. */
export function describeThreshold(threshold: BadgeThresholdParams): string {
  switch (threshold.kind) {
    case BadgeKind.MILESTONE_SESSIONS:
      return `${threshold.sessions} seans`;
    case BadgeKind.STREAK_WEEKS:
      return `${threshold.weeks} hafta üst üste (haftada en az ${threshold.minSessionsPerWeek} seans)`;
    case BadgeKind.MONTHLY_GOAL_MET:
      return 'Aylık hedefe ulaşıldığında';
    case BadgeKind.FIRST_SESSION:
      return 'İlk seansta';
    case BadgeKind.EARLY_BIRD:
      return `Saat ${String(threshold.beforeHour).padStart(2, '0')}:00'dan önce başlayan seans`;
    case BadgeKind.VARIETY:
      return `${threshold.distinctServiceTypes} farklı hizmet türü`;
    default: {
      const _exhaustive: never = threshold;
      return '';
    }
  }
}
