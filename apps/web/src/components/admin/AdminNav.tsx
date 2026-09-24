'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/admin/tenants', label: 'İşletmeler' },
  { href: '/admin/plans', label: 'Planlar' },
  { href: '/admin/business-types', label: 'İşletme Türleri' },
  { href: '/admin/feature-flags', label: 'Özellik Bayrakları' },
  { href: '/admin/sms-packages', label: 'SMS Paketleri' },
  { href: '/admin/content', label: 'Şablon ve Belgeler' },
  { href: '/admin/benchmark', label: 'Karşılaştırma' },
  { href: '/admin/health', label: 'Sistem Sağlığı' },
];

export function AdminNav() {
  const pathname = usePathname();
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
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
