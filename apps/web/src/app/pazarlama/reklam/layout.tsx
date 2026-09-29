'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useT } from '@/components/i18n/I18nProvider';
import { PlatformPageGuard } from '@/components/marketing/PlatformSession';

/** Ads section of the marketing panel: performance and, next to it, connections plus the UTM builder (doc 3.2). */
export default function AdsLayout({ children }: { children: React.ReactNode }) {
  const t = useT();
  const pathname = usePathname() ?? '';
  const tabs = [
    { href: '/pazarlama/reklam', label: t('marketing.ads.performance') },
    { href: '/pazarlama/reklam/ayarlar', label: t('marketing.ads.settings') },
  ];
  return (
    <PlatformPageGuard required={['platform.ads.view']}>
      <div className="flex gap-2 mb-4">
        {tabs.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className="px-3 py-1 text-xs font-medium border"
              style={{
                borderRadius: 'var(--radius-button)',
                borderColor: 'var(--color-border)',
                color: active ? 'var(--color-on-primary)' : 'var(--color-text-secondary)',
                backgroundColor: active ? 'var(--color-primary)' : 'transparent',
              }}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
      {children}
    </PlatformPageGuard>
  );
}
