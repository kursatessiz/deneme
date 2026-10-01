'use client';

import { usePathname } from 'next/navigation';
import { useT } from '@/components/i18n/I18nProvider';
import { MARKETING_NAV_ITEMS, activeMarketingItem, filterMarketingNav } from '@/lib/marketing-nav';
import { usePlatformSession } from './PlatformSession';
import { LinkButton } from '@/components/ui/LinkButton';

/** Permission-driven menu of the marketing panel; same chip style as AdminNav. */
export function MarketingNav() {
  const pathname = usePathname() ?? '';
  const t = useT();
  const { permissions, isSuperAdmin } = usePlatformSession();
  const items = filterMarketingNav(MARKETING_NAV_ITEMS, permissions, isSuperAdmin);
  const active = activeMarketingItem(items, pathname);
  return (
    <nav aria-label={t('marketing.layout.title')} className="ui-tabs flex-wrap pb-3 mb-6">
      {items.map((item) => {
        const isActive = item.key === active;
        return (
          <LinkButton
            key={item.key}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            variant={isActive ? 'solid' : 'link'}
            tone={isActive ? 'theme' : 'surface'}
            size="sm"
          >
            {t(item.labelKey)}
          </LinkButton>
        );
      })}
    </nav>
  );
}
