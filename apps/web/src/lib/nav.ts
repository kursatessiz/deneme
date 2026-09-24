import type { PermissionKey } from '@platform/shared';
import {
  AlertTriangle,
  BarChart3,
  Calendar,
  CheckSquare,
  LayoutDashboard,
  Package,
  Settings,
  UserCog,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import type { ComponentType } from 'react';

export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  /** Any one of these permissions is enough to see the item. Owners always see everything. */
  permissions: readonly PermissionKey[];
}

/**
 * Single nav config for the web panel: every entry maps a route to the
 * permission(s) that unlock it. Navigation and page guards both read from
 * this list, so there is exactly one place that decides what a role sees.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'dashboard', label: 'Genel Bakış', href: '/dashboard', icon: LayoutDashboard, permissions: [] },
  { key: 'calendar', label: 'Takvim', href: '/calendar', icon: Calendar, permissions: ['schedule.view'] },
  { key: 'attendance', label: 'Yoklama', href: '/attendance', icon: CheckSquare, permissions: ['attendance.manage'] },
  { key: 'members', label: 'Üyeler', href: '/members', icon: Users, permissions: ['members.view'] },
  { key: 'packages', label: 'Paket Tanımları', href: '/packages', icon: Package, permissions: ['catalog.view'] },
  { key: 'trainers', label: 'Eğitmenler', href: '/trainers', icon: UserCog, permissions: ['schedule.view'] },

  { key: 'finance', label: 'Finans', href: '/finans', icon: Wallet, permissions: ['finance.view', 'finance.manage', 'promotions.manage'] },
  {
    key: 'payroll',
    label: 'Hakediş',
    href: '/finans/bordro',
    icon: Wallet,
    permissions: ['commissions.view.own', 'commissions.view.all', 'payroll.manage'],
  },
  { key: 'reports', label: 'Raporlar', href: '/raporlar', icon: BarChart3, permissions: ['reports.view'] },
  { key: 'leads', label: 'Adaylar', href: '/adaylar', icon: UserPlus, permissions: ['leads.view'] },
  { key: 'churn', label: 'Riskli Üyeler', href: '/riskli-uyeler', icon: AlertTriangle, permissions: ['reports.view'] },
  {
    key: 'settings',
    label: 'Ayarlar',
    href: '/ayarlar',
    icon: Settings,
    permissions: [
      'studio.settings.view',
      'studio.settings.manage',
      'roles.manage',
      'staff.manage',
      'branches.manage',
      'notifications.manage',
      'integrations.manage',
      'integrations.partners.manage',
    ],
  },];

/** Owners see everything; everyone else needs at least one of an item's permissions (or the item declares none). */
export function filterNavByPermissions(
  items: readonly NavItem[],
  effectivePermissions: readonly PermissionKey[],
  isOwner: boolean,
): NavItem[] {
  if (isOwner) return [...items];
  const granted = new Set(effectivePermissions);
  return items.filter((item) => item.permissions.length === 0 || item.permissions.some((p) => granted.has(p)));
}

/** Whether the active membership may see a page requiring any of `required` (empty = always visible). */
export function hasAnyPermission(
  required: readonly PermissionKey[],
  effectivePermissions: readonly PermissionKey[],
  isOwner: boolean,
): boolean {
  if (isOwner || required.length === 0) return true;
  const granted = new Set(effectivePermissions);
  return required.some((p) => granted.has(p));
}
