'use client';

import Link from 'next/link';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { visibleQuickActions } from '@/lib/quick-actions';

/**
 * Row of shortcuts into the existing screens that perform the most common
 * day-to-day actions (new session, new member, sell package, record
 * payment, check-in). Each entry is only shown when the active membership's
 * permissions unlock it (see `visibleQuickActions`); the bar renders
 * nothing when none apply.
 */
export function QuickActionBar() {
  const t = useT();
  const { permissions, isOwner } = useDashboardSession();
  const actions = visibleQuickActions(permissions, isOwner);

  if (actions.length === 0) return null;

  return (
    <div role="group" aria-label={t('screens.dashboard.quickActions.title')} className="flex flex-wrap gap-2">
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <Link
            key={action.key}
            href={action.href}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 transition-opacity hover:opacity-90"
            style={{
              borderRadius: 'var(--radius-button)',
              border: '1px solid var(--color-border)',
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-text-primary)',
            }}
          >
            <Icon className="w-3.5 h-3.5" />
            {t(action.labelKey)}
          </Link>
        );
      })}
    </div>
  );
}
