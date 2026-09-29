import type { MessageKey, PermissionKey } from '@platform/shared';
import { Calendar, CheckSquare, Package, UserPlus, Wallet } from 'lucide-react';
import type { ComponentType } from 'react';
import { hasAnyPermission } from '@/lib/nav';

export interface QuickAction {
  key: string;
  labelKey: MessageKey;
  href: string;
  icon: ComponentType<{ className?: string }>;
  /** Any one of these permissions unlocks the action; owners always see it. */
  permissions: readonly PermissionKey[];
}

/**
 * The dashboard's quick action bar: shortcuts into the existing screens that
 * perform the most common day-to-day operations. Each entry links to an
 * existing flow -- nothing new is built here, only fast, permission-gated
 * access to it.
 */
export const QUICK_ACTIONS: readonly QuickAction[] = [
  { key: 'new-session', labelKey: 'screens.dashboard.quickActions.newSession', href: '/calendar', icon: Calendar, permissions: ['schedule.manage'] },
  { key: 'new-member', labelKey: 'screens.dashboard.quickActions.newMember', href: '/members', icon: UserPlus, permissions: ['members.manage'] },
  { key: 'sell-package', labelKey: 'screens.dashboard.quickActions.sellPackage', href: '/members', icon: Package, permissions: ['packages.sell'] },
  { key: 'record-payment', labelKey: 'screens.dashboard.quickActions.recordPayment', href: '/finans', icon: Wallet, permissions: ['finance.manage'] },
  { key: 'check-in', labelKey: 'screens.dashboard.quickActions.checkIn', href: '/attendance', icon: CheckSquare, permissions: ['attendance.manage'] },
] as const;

/** Quick actions the active membership's effective permission set unlocks; owners see all of them. */
export function visibleQuickActions(effectivePermissions: readonly PermissionKey[], isOwner: boolean): QuickAction[] {
  return QUICK_ACTIONS.filter((action) => hasAnyPermission(action.permissions, effectivePermissions, isOwner));
}
