import type { MessageKey, PermissionKey } from '@platform/shared';
import {
  AlertTriangle,
  BarChart3,
  Calendar,
  CalendarDays,
  CheckSquare,
  Contact,
  CreditCard,
  Filter,
  Gift,
  Inbox,
  LayoutDashboard,
  Megaphone,
  MessagesSquare,
  Package,
  Send,
  Settings,
  ShoppingBag,
  UserCog,
  UserPlus,
  Users,
  Wallet,
  Workflow,
} from 'lucide-react';
import type { ComponentType } from 'react';

export interface NavItem {
  key: string;
  /** Turkish fallback label, used until the translation loads. */
  label: string;
  /** Translation key rendered instead of `label` once useT() is available. */
  labelKey: MessageKey;
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
  { key: 'dashboard', label: 'Genel Bakış', labelKey: 'nav.dashboard', href: '/dashboard', icon: LayoutDashboard, permissions: [] },
  { key: 'calendar', label: 'Takvim', labelKey: 'nav.calendar', href: '/calendar', icon: Calendar, permissions: ['schedule.view'] },
  {
    key: 'attendance',
    label: 'Yoklama',
    labelKey: 'nav.attendance',
    href: '/attendance',
    icon: CheckSquare,
    permissions: ['attendance.manage'],
  },
  { key: 'events', label: 'Etkinlikler', labelKey: 'nav.events', href: '/etkinlikler', icon: CalendarDays, permissions: ['events.view'] },
  {
    key: 'community',
    label: 'Topluluk',
    labelKey: 'nav.community',
    href: '/topluluk',
    icon: MessagesSquare,
    permissions: ['community.view', 'community.manage'],
  },
  { key: 'members', label: 'Üyeler', labelKey: 'nav.members', href: '/members', icon: Users, permissions: ['members.view'] },
  { key: 'packages', label: 'Paket Tanımları', labelKey: 'nav.packages', href: '/packages', icon: Package, permissions: ['catalog.view'] },
  { key: 'trainers', label: 'Eğitmenler', labelKey: 'nav.trainers', href: '/trainers', icon: UserCog, permissions: ['schedule.view'] },

  {
    key: 'finance',
    label: 'Finans',
    labelKey: 'nav.finance',
    href: '/finans',
    icon: Wallet,
    permissions: ['finance.view', 'finance.manage', 'promotions.manage'],
  },
  {
    key: 'payroll',
    label: 'Hakediş',
    labelKey: 'nav.payroll',
    href: '/finans/bordro',
    icon: Wallet,
    permissions: ['commissions.view.own', 'commissions.view.all', 'payroll.manage'],
  },
  { key: 'retail', label: 'Mağaza', labelKey: 'nav.retail', href: '/magaza', icon: ShoppingBag, permissions: ['retail.view'] },
  { key: 'reports', label: 'Raporlar', labelKey: 'nav.reports', href: '/raporlar', icon: BarChart3, permissions: ['reports.view'] },
  { key: 'leads', label: 'Adaylar', labelKey: 'nav.leads', href: '/adaylar', icon: UserPlus, permissions: ['leads.view'] },
  { key: 'contacts', label: 'Kişiler', labelKey: 'nav.contacts', href: '/kisiler', icon: Contact, permissions: ['crm.view'] },
  { key: 'segments', label: 'Segmentler', labelKey: 'nav.segments', href: '/segmentler', icon: Filter, permissions: ['segments.view'] },
  { key: 'campaigns', label: 'Kampanyalar', labelKey: 'nav.campaigns', href: '/kampanyalar', icon: Send, permissions: ['campaigns.view'] },
  { key: 'journeys', label: 'Otomatik akışlar', labelKey: 'nav.journeys', href: '/akislar', icon: Workflow, permissions: ['journeys.view'] },
  { key: 'inbox', label: 'Gelen Kutusu', labelKey: 'nav.inbox', href: '/gelen-kutusu', icon: Inbox, permissions: ['inbox.view'] },
  {
    key: 'ads',
    label: 'Reklam performansı',
    labelKey: 'nav.ads',
    href: '/reklam-performansi',
    icon: Megaphone,
    permissions: ['ads.view'],
  },
  {
    key: 'churn',
    label: 'Riskli Üyeler',
    labelKey: 'nav.churn',
    href: '/riskli-uyeler',
    icon: AlertTriangle,
    permissions: ['reports.view'],
  },
  { key: 'billing', label: 'Abonelik', labelKey: 'nav.billing', href: '/abonelik', icon: CreditCard, permissions: ['billing.manage'] },
  {
    key: 'businessReferral',
    label: 'Tavsiye et',
    labelKey: 'nav.businessReferral',
    href: '/tavsiye',
    icon: Gift,
    permissions: ['billing.manage'],
  },
  {
    key: 'settings',
    label: 'Ayarlar',
    labelKey: 'nav.settings',
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
      'ads.manage',
      'errors.view',
    ],
  },
];

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
