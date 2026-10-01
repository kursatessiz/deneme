'use client';

import type { PermissionKey } from '@platform/shared';
import type { ButtonHTMLAttributes } from 'react';
import { hasAnyPermission } from '@/lib/nav';
import { firstMissingPermissionLabel } from '@/lib/permission-note';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { Button } from '@/components/ui/Button';
import type { UiTone, UiVariant } from '@/components/ui/types';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Any one of these permissions unlocks the action; owners always see it. Empty means always visible. */
  required?: readonly PermissionKey[];
  variant?: Variant;
  /**
   * 'hide' (default): the button disappears entirely when `required` isn't
   * met. 'disable': the button stays visible but disabled, with a small
   * inline note naming the missing permission underneath, for spots where
   * silently removing the action would be confusing.
   */
  mode?: 'hide' | 'disable';
}

const LOOK: Record<Variant, { variant: UiVariant; tone: UiTone }> = {
  primary: { variant: 'solid', tone: 'theme' },
  secondary: { variant: 'outline', tone: 'surface' },
  danger: { variant: 'outline', tone: 'error' },
  ghost: { variant: 'link', tone: 'muted' },
};

/**
 * A button gated by permission. By default (`mode="hide"`) it disappears
 * entirely when the active membership lacks every permission in
 * `required`. With `mode="disable"` it stays visible but disabled instead,
 * with a small inline note naming the missing permission (from the shared
 * permission catalogue) underneath. Either way the API still enforces the
 * same permission independently -- this only controls what the UI offers.
 */
export function PermissionButton({ required = [], variant = 'secondary', mode = 'hide', className, children, disabled, ...rest }: Props) {
  const { permissions, isOwner } = useDashboardSession();
  const t = useT();
  const allowed = hasAnyPermission(required, permissions, isOwner);
  if (!allowed && mode === 'hide') return null;

  const button = (
    <Button variant={LOOK[variant].variant} tone={LOOK[variant].tone} size="sm" disabled={disabled || !allowed} className={className} {...rest}>
      {children}
    </Button>
  );

  if (allowed) return button;

  const missingLabel = firstMissingPermissionLabel(required, permissions, isOwner);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      {button}
      {missingLabel && <span className="ui-caption">{t('common.permissionRequired', { permission: missingLabel })}</span>}
    </span>
  );
}
