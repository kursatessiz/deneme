'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useT } from '@/components/i18n/I18nProvider';
import { ADMIN_HOME_LINK, ADMIN_LINK_GROUPS } from '@/lib/admin-nav';
import type { AdminLink } from '@/lib/admin-nav';
import { cx } from '@/components/ui/types';

function NavLink({ link, active }: { link: AdminLink; active: boolean }) {
  const t = useT();
  const Icon = link.icon;
  return (
    <Link
      href={link.href}
      aria-current={active ? 'page' : undefined}
      className={cx('pui-btn ui-btn-sm ui-nav-link', active ? 'pui-soft pui-theme' : undefined)}
    >
      <Icon className="ui-icon" aria-hidden="true" />
      {t(link.labelKey)}
    </Link>
  );
}

/** Super admin sidebar navigation: the overview link, then the section groups of lib/admin-nav.ts. */
export function AdminNav() {
  const pathname = usePathname() ?? '';
  const t = useT();
  const isActive = (href: string) => (href === '/admin' ? pathname === '/admin' : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <nav aria-label={t('adminNav.navLabel')} className="grid gap-4">
      <NavLink link={ADMIN_HOME_LINK} active={isActive(ADMIN_HOME_LINK.href)} />
      {ADMIN_LINK_GROUPS.map((group) => (
        <div key={group.key} className="grid gap-1">
          <span className="ui-caption px-3">{t(group.labelKey)}</span>
          {group.links.map((link) => (
            <NavLink key={link.href} link={link} active={isActive(link.href)} />
          ))}
        </div>
      ))}
    </nav>
  );
}
