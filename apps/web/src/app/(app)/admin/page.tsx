import Link from 'next/link';
import { ADMIN_LINK_GROUPS } from '@/lib/admin-nav';
import { getT } from '@/lib/i18n/getT';
import { PageHeader } from '@/components/ui/PageHeader';

/** Super admin overview: every console section in its group, one card per group. */
export default async function AdminIndexPage() {
  const { t } = await getT();
  return (
    <div className="grid gap-6">
      <PageHeader title={t('adminNav.home')} description={t('adminNav.homeDescription')} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {ADMIN_LINK_GROUPS.map((group) => (
          <section key={group.key} className="pui-card">
            <div className="pui-card-header">
              <h3 className="ui-heading">{t(group.labelKey)}</h3>
            </div>
            <ul className="pui-list grid gap-1 p-2">
              {group.links.map((link) => {
                const Icon = link.icon;
                return (
                  <li key={link.href}>
                    <Link href={link.href} className="pui-btn ui-nav-link">
                      <span className="pui-badge pui-soft pui-theme" aria-hidden="true">
                        <Icon className="ui-icon" />
                      </span>
                      {t(link.labelKey)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
