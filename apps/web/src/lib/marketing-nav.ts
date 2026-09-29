import type { MessageKey, PlatformPermissionKey } from '@platform/shared';

export interface MarketingNavItem {
  key: string;
  labelKey: MessageKey;
  href: string;
  /** Any one of these platform permissions shows the item; super admins see everything. */
  permissions: readonly PlatformPermissionKey[];
}

/**
 * Menu of the marketing panel (/pazarlama, docs/PAZARLAMA_MODULU.md 3.2).
 * Items read platform permissions, never tenant ones: the reused tenant
 * pages still guard themselves with the derived tenant permissions.
 */
export const MARKETING_NAV_ITEMS: readonly MarketingNavItem[] = [
  { key: 'dashboard', labelKey: 'marketing.nav.dashboard', href: '/pazarlama', permissions: ['platform.marketing.view'] },
  { key: 'approvals', labelKey: 'marketing.nav.approvals', href: '/pazarlama/onaylar', permissions: ['platform.marketing.view', 'platform.marketing.send', 'platform.marketing.approve'] },
  { key: 'calendar', labelKey: 'marketing.nav.calendar', href: '/pazarlama/takvim', permissions: ['platform.marketing.view', 'platform.marketing.manage'] },
  { key: 'aiStudio', labelKey: 'marketing.nav.aiStudio', href: '/pazarlama/yapay-zeka', permissions: ['platform.ai.use'] },
  { key: 'contacts', labelKey: 'marketing.nav.contacts', href: '/pazarlama/kisiler', permissions: ['platform.marketing.view'] },
  { key: 'segments', labelKey: 'marketing.nav.segments', href: '/pazarlama/segmentler', permissions: ['platform.marketing.view'] },
  { key: 'campaigns', labelKey: 'marketing.nav.campaigns', href: '/pazarlama/kampanyalar', permissions: ['platform.marketing.view'] },
  { key: 'journeys', labelKey: 'marketing.nav.journeys', href: '/pazarlama/akislar', permissions: ['platform.marketing.view'] },
  { key: 'inbox', labelKey: 'marketing.nav.inbox', href: '/pazarlama/gelen-kutusu', permissions: ['platform.marketing.view'] },
  { key: 'templates', labelKey: 'marketing.nav.templates', href: '/pazarlama/sablonlar', permissions: ['platform.marketing.manage'] },
  { key: 'site', labelKey: 'marketing.nav.site', href: '/pazarlama/site', permissions: ['platform.marketing.manage'] },
  { key: 'ads', labelKey: 'marketing.nav.ads', href: '/pazarlama/reklam', permissions: ['platform.ads.view'] },
  { key: 'reports', labelKey: 'marketing.nav.reports', href: '/pazarlama/raporlar', permissions: ['platform.marketing.view'] },
  { key: 'integrations', labelKey: 'marketing.nav.integrations', href: '/pazarlama/entegrasyonlar', permissions: ['platform.integrations.manage'] },
  { key: 'brand', labelKey: 'marketing.nav.brand', href: '/pazarlama/marka', permissions: ['platform.brand.manage', 'platform.marketing.view'] },
];

export function hasAnyPlatformPermission(
  required: readonly PlatformPermissionKey[],
  granted: readonly PlatformPermissionKey[],
  isSuperAdmin: boolean,
): boolean {
  if (isSuperAdmin || required.length === 0) return true;
  return required.some((key) => granted.includes(key));
}

export function filterMarketingNav(
  items: readonly MarketingNavItem[],
  granted: readonly PlatformPermissionKey[],
  isSuperAdmin: boolean,
): MarketingNavItem[] {
  return items.filter((item) => hasAnyPlatformPermission(item.permissions, granted, isSuperAdmin));
}

/** The longest menu entry that owns `pathname` (so /pazarlama is active only on the dashboard itself). */
export function activeMarketingItem(items: readonly MarketingNavItem[], pathname: string): string | null {
  let best: MarketingNavItem | null = null;
  for (const item of items) {
    const match = item.href === '/pazarlama' ? pathname === '/pazarlama' : pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (match && (!best || item.href.length > best.href.length)) best = item;
  }
  return best?.key ?? null;
}
