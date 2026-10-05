import type { trMDashboard } from '../tr/mDashboard';

export const enMDashboard: Record<keyof typeof trMDashboard, string> = {
  'mDashboard.title': 'Overview',
  'mDashboard.trash.label': 'Drop here to remove',
  'mDashboard.card.hint': 'Press and hold, then drag to the trash can to remove.',
  'mDashboard.card.dragging': 'Moving {title}. Drop it on the trash can to remove.',
  'mDashboard.card.cancelled': 'Removal cancelled.',
  'mDashboard.empty.notOnMobile': 'This card is not shown on mobile.',
} as const;
