'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { MembershipDTO } from '@platform/shared';
import { filterNavByPermissions, NAV_ITEMS } from '@/lib/nav';
import { setActiveStudioCookie } from '@/lib/session/active-selection';
import { useT } from '@/components/i18n/I18nProvider';
import { Avatar } from '@/components/ui/Avatar';
import { FieldGroup } from '@/components/ui/FieldGroup';
import { Select } from '@/components/ui/Select';
import { cx } from '@/components/ui/types';

/**
 * Dashboard sidebar: the tenant's logo and name, the business switcher for
 * people with more than one membership, and the permission-filtered nav
 * (lib/nav.ts) with Lucide icons. Flat page color with a hairline border;
 * the active item is `pui-soft pui-theme`.
 */
export function Sidebar({
  memberships,
  activeMembership,
  logoUrl,
}: {
  memberships: MembershipDTO[];
  activeMembership: MembershipDTO;
  logoUrl: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useT();
  const items = filterNavByPermissions(NAV_ITEMS, activeMembership.permissions, activeMembership.isOwner);

  function switchStudio(studioId: string) {
    if (studioId === activeMembership.studioId) return;
    setActiveStudioCookie(studioId);
    router.refresh();
  }

  return (
    <aside className="w-64 shrink-0 min-h-screen flex flex-col gap-4 p-4" style={{ borderRight: 'var(--pui-border-width) solid var(--pui-border)' }}>
      <div className="flex items-center gap-3 px-1 py-1">
        <Avatar name={activeMembership.studioName} src={logoUrl} />
        <div className="grid min-w-0">
          <span className="ui-heading truncate">{activeMembership.studioName}</span>
          <span className="ui-caption">{t('layout.managementPanel')}</span>
        </div>
      </div>

      {memberships.length > 1 && (
        <FieldGroup label={t('layout.activeStudio')} className="px-1">
          <Select value={activeMembership.studioId} onChange={(e) => switchStudio(e.target.value)}>
            {memberships.map((m) => (
              <option key={m.studioId} value={m.studioId}>
                {m.studioName}
              </option>
            ))}
          </Select>
        </FieldGroup>
      )}

      <nav className="flex-1 grid content-start gap-1">
        {items.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={cx('pui-btn ui-nav-link', isActive && 'pui-soft pui-theme')}
            >
              <Icon className="ui-icon" aria-hidden="true" />
              {t(item.labelKey)}
            </Link>
          );
        })}
      </nav>

      <div className="ui-caption px-1">{activeMembership.roleName}</div>
    </aside>
  );
}
