'use client';

import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { visibleQuickActions } from '@/lib/quick-actions';
import { LinkButton } from '@/components/ui/LinkButton';

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
      {actions.map((action, index) => {
        const Icon = action.icon;
        return (
          <LinkButton
            key={action.key}
            href={action.href}
            size="sm"
            variant={index === 0 ? 'solid' : 'outline'}
            tone={index === 0 ? 'theme' : 'surface'}
            icon={<Icon className="ui-icon" aria-hidden="true" />}
          >
            {t(action.labelKey)}
          </LinkButton>
        );
      })}
    </div>
  );
}
