'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useT } from '@/components/i18n/I18nProvider';

const LINKS: ReadonlyArray<{ href: string; labelKey: string }> = [
  { href: '/admin/tenants', labelKey: 'adminNav.tenants' },
  { href: '/admin/plans', labelKey: 'adminNav.plans' },
  { href: '/admin/referrals', labelKey: 'adminBilling.nav' },
  { href: '/admin/business-types', labelKey: 'adminNav.businessTypes' },
  { href: '/admin/feature-flags', labelKey: 'adminNav.featureFlags' },
  { href: '/admin/sms-packages', labelKey: 'adminNav.smsPackages' },
  { href: '/admin/content', labelKey: 'adminNav.content' },
  { href: '/admin/web-sitesi', labelKey: 'adminNav.webSitesi' },
  { href: '/admin/i18n', labelKey: 'adminNav.languages' },
  { href: '/admin/ai', labelKey: 'adminAi.nav' },
  { href: '/admin/benchmark', labelKey: 'adminNav.benchmark' },
  { href: '/admin/health', labelKey: 'adminNav.health' },
  { href: '/admin/hatalar', labelKey: 'adminErrors.nav' },
];

export function AdminNav() {
  const pathname = usePathname();
  const t = useT();
  return (
    <nav className="flex flex-wrap gap-1 border-b pb-3 mb-6" style={{ borderColor: 'var(--color-border)' }}>
      {LINKS.map((link) => {
        const active = pathname === link.href || pathname?.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            className="px-3 py-1.5 text-sm font-medium transition-colors"
            style={{
              borderRadius: 'var(--radius-chip)',
              color: active ? 'var(--color-on-primary)' : 'var(--color-text-secondary)',
              backgroundColor: active ? 'var(--color-primary)' : 'transparent',
            }}
          >
            {t(link.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
