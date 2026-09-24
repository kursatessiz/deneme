'use client';

import Link from 'next/link';
import type { PermissionKey } from '@platform/shared';
import { Award, ChevronRight, KeyRound, Layers, Palette, ShieldCheck, Store } from 'lucide-react';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { hasAnyPermission } from '@/lib/nav';
import { SettingsHeader } from '@/components/settings/ui';

interface SettingsCard {
  key: string;
  href: string;
  title: string;
  description: string;
  icon: typeof ShieldCheck;
  permissions: readonly PermissionKey[];
}

const CARDS: SettingsCard[] = [
  {
    key: 'roller',
    href: '/ayarlar/roller',
    title: 'Roller ve yetkiler',
    description: 'Rol tanımları, izin kümeleri ve personel rol ataması',
    icon: ShieldCheck,
    permissions: ['roles.manage'],
  },
  {
    key: 'gorunum',
    href: '/ayarlar/gorunum',
    title: 'Görünüm',
    description: 'İşletme teması, logo, birincil renk ve kişisel görünüm tercihi',
    icon: Palette,
    permissions: ['studio.settings.view', 'studio.settings.manage'],
  },
  {
    key: 'subeler',
    href: '/ayarlar/subeler',
    title: 'Şubeler',
    description: 'Şube tanımları ve personelin şube erişimi',
    icon: Store,
    permissions: ['branches.manage', 'reports.view'],
  },
  {
    key: 'isletme',
    href: '/ayarlar/isletme',
    title: 'İşletme',
    description: 'İptal politikası, check-in penceresi, bildirim ve oyunlaştırma ayarları',
    icon: Layers,
    permissions: ['studio.settings.view', 'studio.settings.manage', 'notifications.manage', 'catalog.manage'],
  },
  {
    key: 'rozetler',
    href: '/ayarlar/rozetler',
    title: 'Rozetler',
    description: 'Küresel ve işletmenize özel oyunlaştırma rozetlerini yönetin',
    icon: Award,
    permissions: ['reports.view', 'studio.settings.manage'],
  },
  {
    key: 'entegrasyonlar',
    href: '/ayarlar/entegrasyonlar',
    title: 'Entegrasyonlar',
    description: 'API anahtarları, webhook uç noktaları ve partner platform bağlantıları',
    icon: KeyRound,
    permissions: ['integrations.manage', 'integrations.partners.manage'],
  },
];

export default function SettingsHubPage() {
  const { permissions, isOwner } = useDashboardSession();
  const visible = CARDS.filter((c) => hasAnyPermission(c.permissions, permissions, isOwner));

  return (
    <div className="space-y-6">
      <SettingsHeader title="Ayarlar" description="İşletme, roller ve entegrasyon ayarlarını buradan yönetin" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {visible.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.key}
              href={card.href}
              className="p-5 border flex items-start gap-4 transition-colors hover:opacity-90"
              style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-card)' }}
            >
              <div
                className="p-2.5 shrink-0"
                style={{ backgroundColor: 'var(--color-surface-muted)', borderRadius: 'var(--radius-card)', color: 'var(--color-primary)' }}
              >
                <Icon className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  {card.title}
                </h3>
                <p className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                  {card.description}
                </p>
              </div>
              <ChevronRight className="w-4 h-4 shrink-0 mt-1" style={{ color: 'var(--color-text-muted)' }} />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
