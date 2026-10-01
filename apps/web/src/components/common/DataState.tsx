'use client';

import { Loader2 } from 'lucide-react';
import type { MessageKey, PermissionKey } from '@platform/shared';
import { useT } from '@/components/i18n/I18nProvider';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { hasAnyPermission } from '@/lib/nav';
import { useAreaHref } from '@/components/session/AreaBase';
import { EmptyState as UiEmptyState } from '@/components/ui/EmptyState';
import { LinkButton } from '@/components/ui/LinkButton';

/** `label` defaults to the translated "Loading..." when the caller does not pass its own copy. */
export function LoadingState({ label }: { label?: string }) {
  const t = useT();
  return (
    <div className="ui-text-muted flex items-center justify-center py-20 gap-2">
      <Loader2 className="ui-icon animate-spin" aria-hidden="true" />
      <span>{label ?? t('common.loading')}</span>
    </div>
  );
}

export interface EmptyStateAction {
  /** Translation key for the button label. */
  labelKey: MessageKey;
  href: string;
  /** Any one of these permissions unlocks the action; owners always see it. Omit for an action anyone on the page may take. */
  permissions?: readonly PermissionKey[];
}

/**
 * The action link's own component, so `useDashboardSession()` is only
 * called from a subtree that actually mounts when an `action` is passed.
 * Screens outside the tenant dashboard (e.g. the super admin panel) render
 * `EmptyState` with no `action` and never reach this hook.
 */
function EmptyStateActionLink({ action }: { action: EmptyStateAction }) {
  const t = useT();
  const { permissions, isOwner } = useDashboardSession();
  const areaHref = useAreaHref();
  if (!hasAnyPermission(action.permissions ?? [], permissions, isOwner)) return null;
  return (
    <LinkButton href={areaHref(action.href)} size="sm">
      {t(action.labelKey)}
    </LinkButton>
  );
}

/**
 * Shared empty state for list screens: a title, an optional one-sentence
 * explanation, and an optional primary action link. The action only
 * renders when the active membership's permissions unlock it (owners
 * always see it), so a screen never offers an action the API would reject.
 */
export function EmptyState({ title, description, action }: { title?: string; description?: string; action?: EmptyStateAction }) {
  const t = useT();
  return (
    <UiEmptyState
      title={title ?? t('common.empty')}
      description={description}
      action={action ? <EmptyStateActionLink action={action} /> : undefined}
    />
  );
}

export function ErrorState({ message }: { message?: string }) {
  const t = useT();
  return (
    <div className="ui-alert">{message ?? t('common.error.generic')}</div>
  );
}
