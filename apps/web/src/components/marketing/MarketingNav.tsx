'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useT } from '@/components/i18n/I18nProvider';
import { MARKETING_NAV_ITEMS, activeMarketingItem, filterMarketingNav } from '@/lib/marketing-nav';
import { usePlatformSession } from './PlatformSession';

/** Permission-driven menu of the marketing panel; same chip style as AdminNav. */
export function MarketingNav() {
  const pathname = usePathname() ?? '';
  const t = useT();
  const { permissions, isSuperAdmin } = usePlatformSession();
  const items = filterMarketingNav(MARKETING_NAV_ITEMS, permissions, isSuperAdmin);
  const active = activeMarketingItem(items, pathname);
  return (
    <nav aria-label={t('marketing.layout.title')} className="flex flex-wrap gap-1 border-b pb-3 mb-6" style={{ borderColor: 'var(--color-border)' }}>
      {items.map((item) => {
        const isActive = item.key === active;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className="px-3 py-1.5 text-sm font-medium transition-colors"
            style={{
              borderRadius: 'var(--radius-chip)',
              color: isActive ? 'var(--color-on-primary)' : 'var(--color-text-secondary)',
              backgroundColor: isActive ? 'var(--color-primary)' : 'transparent',
            }}
          >
            {t(item.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
