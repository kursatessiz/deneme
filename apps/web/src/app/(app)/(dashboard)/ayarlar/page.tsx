'use client';

import Link from 'next/link';
import type { PermissionKey } from '@platform/shared';
import {
  AlertTriangle,
  Award,
  ChevronRight,
  Gift,
  Globe,
  KeyRound,
  Layers,
  Megaphone,
  MessageSquareText,
  Palette,
  Puzzle,
  ShieldCheck,
  Store,
  UsersRound,
} from 'lucide-react';
import { useT } from '@/components/i18n/I18nProvider';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { hasAnyPermission } from '@/lib/nav';
import { SettingsHeader } from '@/components/settings/ui';
import { Badge } from '@/components/ui/Badge';

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
    key: 'sadakat',
    href: '/ayarlar/sadakat',
    titleKey: 'settings.hub.loyalty.title',
    descriptionKey: 'settings.hub.loyalty.description',
    icon: Gift,
    permissions: ['loyalty.view', 'loyalty.manage'],
  },
  {
    key: 'topluluk',
    href: '/ayarlar/topluluk',
    titleKey: 'settings.hub.community.title',
    descriptionKey: 'settings.hub.community.description',
    icon: UsersRound,
    permissions: ['community.view', 'community.manage'],
  },
  {
    key: 'web-sitem',
    href: '/ayarlar/web-sitem',
    titleKey: 'settings.hub.site.title',
    descriptionKey: 'settings.hub.site.description',
    icon: Globe,
    permissions: ['site.view', 'site.manage', 'sites.articles.manage'],
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
  {
    key: 'uygulamalar',
    href: '/ayarlar/uygulamalar',
    titleKey: 'settings.hub.addOns.title',
    descriptionKey: 'settings.hub.addOns.description',
    icon: Puzzle,
    permissions: ['billing.manage'],
  },
  {
    key: 'hatalar',
    href: '/ayarlar/hatalar',
    titleKey: 'errors.hub.title',
    descriptionKey: 'errors.hub.description',
    icon: AlertTriangle,
    permissions: ['errors.view'],
  },
];

export default function SettingsHubPage() {
  const { permissions, isOwner } = useDashboardSession();
  const t = useT();
  const visible = CARDS.filter((c) => hasAnyPermission(c.permissions, permissions, isOwner));

  return (
    <div className="grid gap-6">
      <SettingsHeader title={t('settings.hub.title')} description={t('settings.hub.description')} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {visible.map((card) => {
          const Icon = card.icon;
          return (
            <Link key={card.key} href={card.href} className="pui-card ui-card-link flex items-start gap-4 p-5">
              <Badge tone="theme" className="shrink-0">
                <Icon className="ui-icon" aria-hidden="true" />
              </Badge>
              <div className="flex-1 min-w-0 grid gap-1">
                <h3 className="ui-heading">{t(card.titleKey)}</h3>
                <p className="ui-caption">{t(card.descriptionKey)}</p>
              </div>
              <ChevronRight className="ui-icon ui-text-muted" aria-hidden="true" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
