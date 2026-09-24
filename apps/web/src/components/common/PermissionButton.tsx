'use client';

import type { PermissionKey } from '@platform/shared';
import type { ButtonHTMLAttributes } from 'react';
import { hasAnyPermission } from '@/lib/nav';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Any one of these permissions unlocks the action; owners always see it. Empty means always visible. */
  required?: readonly PermissionKey[];
  variant?: Variant;
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
 * A button that hides itself (returns null) when the active membership lacks
 * every permission in `required`. The API still enforces the same
 * permission independently -- this only keeps unusable actions off the UI.
 */
export function PermissionButton({ required = [], variant = 'secondary', className, style, children, ...rest }: Props) {
  const { permissions, isOwner } = useDashboardSession();
  if (!hasAnyPermission(required, permissions, isOwner)) return null;
  return (
    <button
      type="button"
      className={`text-xs font-medium px-3 py-1.5 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 ${className ?? ''}`}
      style={{ borderRadius: 'var(--radius-button)', ...VARIANT_STYLE[variant](true), ...style }}
      {...rest}
    >
      {children}
    </button>
  );
}
