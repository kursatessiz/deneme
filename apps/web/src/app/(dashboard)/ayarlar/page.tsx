'use client';

import Link from 'next/link';
import type { PermissionKey } from '@platform/shared';
import { Award, ChevronRight, Globe, KeyRound, Layers, Megaphone, MessageSquareText, Palette, ShieldCheck, Store } from 'lucide-react';
import { useT } from '@/components/i18n/I18nProvider';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { hasAnyPermission } from '@/lib/nav';
import { SettingsHeader } from '@/components/settings/ui';

interface SettingsCard {
  key: string;
  href: string;
  titleKey: string;
  descriptionKey: string;
  icon: typeof ShieldCheck;
  permissions: readonly PermissionKey[];
}

const CARDS: SettingsCard[] = [
  {
    key: 'roller',
    href: '/ayarlar/roller',
    titleKey: 'settings.hub.roles.title',
    descriptionKey: 'settings.hub.roles.description',
    icon: ShieldCheck,
    permissions: ['roles.manage'],
  },
  {
    key: 'gorunum',
    href: '/ayarlar/gorunum',
    titleKey: 'settings.hub.appearance.title',
    descriptionKey: 'settings.hub.appearance.description',
    icon: Palette,
    permissions: ['studio.settings.view', 'studio.settings.manage'],
  },
  {
    key: 'subeler',
    href: '/ayarlar/subeler',
    titleKey: 'settings.hub.branches.title',
    descriptionKey: 'settings.hub.branches.description',
    icon: Store,
    permissions: ['branches.manage', 'reports.view'],
  },
  {
    key: 'isletme',
    href: '/ayarlar/isletme',
    titleKey: 'settings.hub.business.title',
    descriptionKey: 'settings.hub.business.description',
    icon: Layers,
    permissions: ['studio.settings.view', 'studio.settings.manage', 'notifications.manage', 'catalog.manage'],
  },
  {
    key: 'mesaj-sablonlari',
    href: '/ayarlar/mesaj-sablonlari',
    titleKey: 'messaging.templates.title',
    descriptionKey: 'messaging.templates.settingsDescription',
    icon: MessageSquareText,
    permissions: ['notifications.manage'],
  },
  {
    key: 'rozetler',
    href: '/ayarlar/rozetler',
    titleKey: 'settings.hub.badges.title',
    descriptionKey: 'settings.hub.badges.description',
    icon: Award,
    permissions: ['reports.view', 'studio.settings.manage'],
  },
  {
    key: 'web-sitem',
    href: '/ayarlar/web-sitem',
    titleKey: 'settings.hub.site.title',
    descriptionKey: 'settings.hub.site.description',
    icon: Globe,
    permissions: ['site.view', 'site.manage'],
  },
  {
    key: 'entegrasyonlar',
    href: '/ayarlar/entegrasyonlar',
    titleKey: 'settings.hub.integrations.title',
    descriptionKey: 'settings.hub.integrations.description',
    icon: KeyRound,
    permissions: ['integrations.manage', 'integrations.partners.manage'],
  },
  {
    key: 'reklam',
    href: '/ayarlar/reklam',
    titleKey: 'settings.hub.ads.title',
    descriptionKey: 'settings.hub.ads.description',
    icon: Megaphone,
    permissions: ['ads.manage'],
  },
];

export default function SettingsHubPage() {
  const { permissions, isOwner } = useDashboardSession();
  const t = useT();
  const visible = CARDS.filter((c) => hasAnyPermission(c.permissions, permissions, isOwner));

  return (
    <div className="space-y-6">
      <SettingsHeader title={t('settings.hub.title')} description={t('settings.hub.description')} />
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
                  {t(card.titleKey)}
                </h3>
                <p className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                  {t(card.descriptionKey)}
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
