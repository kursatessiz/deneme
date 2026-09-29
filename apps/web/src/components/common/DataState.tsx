'use client';

import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import type { MessageKey, PermissionKey } from '@platform/shared';
import { useT } from '@/components/i18n/I18nProvider';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { hasAnyPermission } from '@/lib/nav';

/** `label` defaults to the translated "Loading..." when the caller does not pass its own Turkish copy. */
export function LoadingState({ label }: { label?: string }) {
  const t = useT();
  return (
    <div className="flex items-center justify-center py-20 gap-2" style={{ color: 'var(--color-text-muted)' }}>
      <Loader2 className="w-4 h-4 animate-spin" />
      <span className="text-sm">{label ?? t('common.loading')}</span>
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
  if (!hasAnyPermission(action.permissions ?? [], permissions, isOwner)) return null;
  return (
    <Link
      href={action.href}
      className="text-xs font-medium px-3.5 py-2 mt-4 transition-opacity hover:opacity-90"
      style={{ borderRadius: 'var(--radius-button)', background: 'var(--gradient-brand)', color: 'var(--color-on-primary)' }}
    >
      {t(action.labelKey)}
    </Link>
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
    <div
      className="flex flex-col items-center justify-center text-center py-20 rounded-2xl border"
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
    >
      <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
        {title ?? t('common.empty')}
      </h3>
      {description && (
        <p className="text-xs mt-1 max-w-sm" style={{ color: 'var(--color-text-secondary)' }}>
          {description}
        </p>
      )}
      {action && <EmptyStateActionLink action={action} />}
    </div>
  );
}

export function ErrorState({ message }: { message?: string }) {
  const t = useT();
  return (
    <div className="rounded-2xl border py-10 px-6 text-center text-sm" style={{ borderColor: 'var(--color-border)', color: 'var(--color-danger, #b42318)' }}>
      {message ?? t('common.error.generic')}
    </div>
  );
}
