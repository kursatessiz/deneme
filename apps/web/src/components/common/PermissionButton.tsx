'use client';

import type { PermissionKey } from '@platform/shared';
import type { ButtonHTMLAttributes } from 'react';
import { hasAnyPermission } from '@/lib/nav';
import { firstMissingPermissionLabel } from '@/lib/permission-note';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Any one of these permissions unlocks the action; owners always see it. Empty means always visible. */
  required?: readonly PermissionKey[];
  variant?: Variant;
  /**
   * 'hide' (default): the button disappears entirely when `required` isn't
   * met, same as before. 'disable': the button stays visible but disabled,
   * with a small inline note naming the missing permission underneath, for
   * spots where silently removing the action would be confusing.
   */
  mode?: 'hide' | 'disable';
}

const VARIANT_STYLE: Record<Variant, (primary: boolean) => React.CSSProperties> = {
  primary: () => ({ background: 'var(--gradient-brand)', color: 'var(--color-on-primary)', border: 'none' }),
  secondary: () => ({
    background: 'var(--color-surface)',
    color: 'var(--color-text-primary)',
    border: '1px solid var(--color-border)',
  }),
  danger: () => ({ background: 'transparent', color: '#b42318', border: '1px solid #f3a19a' }),
  ghost: () => ({ background: 'transparent', color: 'var(--color-text-secondary)', border: '1px solid transparent' }),
};

/**
 * A button gated by permission. By default (`mode="hide"`) it disappears
 * entirely when the active membership lacks every permission in
 * `required`. With `mode="disable"` it stays visible but disabled instead,
 * with a small inline note naming the missing permission (from the shared
 * permission catalogue) underneath. Either way the API still enforces the
 * same permission independently -- this only controls what the UI offers.
 */
export function PermissionButton({ required = [], variant = 'secondary', mode = 'hide', className, style, children, disabled, ...rest }: Props) {
  const { permissions, isOwner } = useDashboardSession();
  const t = useT();
  const allowed = hasAnyPermission(required, permissions, isOwner);
  if (!allowed && mode === 'hide') return null;

  const button = (
    <button
      type="button"
      disabled={disabled || !allowed}
      className={`text-xs font-medium px-3 py-1.5 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 ${className ?? ''}`}
      style={{ borderRadius: 'var(--radius-button)', ...VARIANT_STYLE[variant](true), ...style }}
      {...rest}
    >
      {children}
    </button>
  );

  if (allowed) return button;

  const missingLabel = firstMissingPermissionLabel(required, permissions, isOwner);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      {button}
      {missingLabel && (
        <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
          {t('common.permissionRequired', { permission: missingLabel })}
        </span>
      )}
    </span>
  );
}
