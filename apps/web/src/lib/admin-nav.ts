import type { MessageKey } from '@platform/shared';
import {
  Activity,
  BarChart3,
  Bot,
  Building2,
  ClipboardList,
  CreditCard,
  DatabaseBackup,
  FileText,
  Flag,
  Gift,
  Globe,
  Languages,
  LayoutDashboard,
  Megaphone,
  MessageSquare,
  Plug,
  Puzzle,
  ShieldCheck,
  SlidersHorizontal,
  TriangleAlert,
  Users,
} from 'lucide-react';
import type { ComponentType } from 'react';

export interface AdminLink {
  href: string;
  labelKey: MessageKey;
  icon: ComponentType<{ className?: string }>;
}

export interface AdminLinkGroup {
  key: string;
  labelKey: MessageKey;
  links: readonly AdminLink[];
}

/**
 * The super admin console's sections, in groups. AdminNav (the sidebar) and
 * the /admin overview both read this list; it is a plain module so server
 * components can import it.
 */
export const ADMIN_LINK_GROUPS: readonly AdminLinkGroup[] = [
  {
    key: 'business',
    labelKey: 'adminNav.group.business',
    links: [
      { href: '/admin/tenants', labelKey: 'adminNav.tenants', icon: Building2 },
      { href: '/admin/plans', labelKey: 'adminNav.plans', icon: CreditCard },
      { href: '/admin/referrals', labelKey: 'adminBilling.nav', icon: Gift },
      { href: '/admin/uygulama-pazari', labelKey: 'adminAddOns.nav', icon: Puzzle },
    ],
  },
  {
    key: 'product',
    labelKey: 'adminNav.group.product',
    links: [
      { href: '/admin/business-types', labelKey: 'adminNav.businessTypes', icon: ClipboardList },
      { href: '/admin/feature-flags', labelKey: 'adminNav.featureFlags', icon: Flag },
      { href: '/admin/sms-packages', labelKey: 'adminNav.smsPackages', icon: MessageSquare },
      { href: '/admin/content', labelKey: 'adminNav.content', icon: FileText },
      { href: '/admin/web-sitesi', labelKey: 'adminNav.webSitesi', icon: Globe },
      { href: '/admin/i18n', labelKey: 'adminNav.languages', icon: Languages },
      { href: '/admin/ai', labelKey: 'adminAi.nav', icon: Bot },
      // M3b: approval thresholds, caps and weekly summary of the platform's own marketing.
      { href: '/admin/pazarlama-ayarlari', labelKey: 'adminMarketingSettings.nav', icon: SlidersHorizontal },
    ],
  },
  {
    key: 'operations',
    labelKey: 'adminNav.group.operations',
    links: [
      { href: '/admin/benchmark', labelKey: 'adminNav.benchmark', icon: BarChart3 },
      { href: '/admin/health', labelKey: 'adminNav.health', icon: Activity },
      { href: '/admin/yedekler', labelKey: 'adminNav.backups', icon: DatabaseBackup },
      { href: '/admin/hatalar', labelKey: 'adminErrors.nav', icon: TriangleAlert },
      // M3d: who did what (AuditLog) across every tenant.
      { href: '/admin/denetim', labelKey: 'adminAudit.nav', icon: ShieldCheck },
    ],
  },
  {
    key: 'platform',
    labelKey: 'adminNav.group.platform',
    links: [
      // M1: platform users, the shared integrations hub and the marketing panel (one console for the owner).
      { href: '/admin/platform-kullanicilari', labelKey: 'adminPlatformUsers.nav', icon: Users },
      { href: '/admin/entegrasyonlar', labelKey: 'adminPlatformUsers.navIntegrations', icon: Plug },
      { href: '/pazarlama', labelKey: 'adminPlatformUsers.navMarketing', icon: Megaphone },
    ],
  },
];

export const ADMIN_HOME_LINK: AdminLink = { href: '/admin', labelKey: 'adminNav.home', icon: LayoutDashboard };
