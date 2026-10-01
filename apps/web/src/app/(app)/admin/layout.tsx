import type { Metadata } from 'next';
import { noindexMetadata } from '@/lib/seo/noindex';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { PRODUCT_NAME } from '@platform/shared';
import { getSessionUser, twoFactorRedirect } from '@/lib/session/admin-session';
import { AdminTheme } from '@/components/admin/AdminTheme';
import { AdminNav } from '@/components/admin/AdminNav';
import { Avatar } from '@/components/ui/Avatar';
import { getT } from '@/lib/i18n/getT';
import { fetchPlatformBrand } from '@/lib/sites/api';

export async function generateMetadata(): Promise<Metadata> {
  return noindexMetadata('seo.panel.title');
}

/**
 * `/admin` route group: the super-admin (platform owner) panel, backlog
 * 4.1-4.3. Visible only when the session user is isSuperAdmin - checked
 * here, server-side, in addition to the API's SuperAdminGuard on every
 * /admin/* endpoint (CLAUDE.md security note: the real boundary is the API
 * guard, this is defense in depth for the page shell).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/giris?sonra=/admin');
  // M1: a platform member (e.g. the marketing admin) is never a super admin;
  // their only console is /pazarlama, integrations hub included.
  if (!user.isSuperAdmin) redirect(user.platformAccess ? '/pazarlama' : '/giris?sonra=/admin');
  const mfaTarget = twoFactorRedirect(user, '/admin');
  if (mfaTarget) redirect(mfaTarget);
  const { t } = await getT();
  const brand = await fetchPlatformBrand();
  const fullName = `${user.firstName} ${user.lastName}`;

  return (
    <div className="admin-root">
      <AdminTheme primary={brand.themePrimary} />
      <div className="flex min-h-screen">
        <aside className="w-64 shrink-0 flex flex-col gap-6 p-4" style={{ borderRight: 'var(--pui-border-width) solid var(--pui-border)' }}>
          <div className="flex items-center gap-3 px-1">
            <Avatar name={PRODUCT_NAME} src={brand.logoUrl} />
            <div className="grid">
              <span className="ui-heading">{PRODUCT_NAME}</span>
              <span className="ui-caption">{t('adminNav.layout.kicker')}</span>
            </div>
          </div>
          <AdminNav />
        </aside>
        <div className="flex-1 min-w-0">
          <div className="max-w-6xl mx-auto px-6 py-8 grid gap-6">
            <header className="flex flex-wrap items-center justify-between gap-3">
              <div className="grid gap-1">
                <span className="ui-caption">{t('adminNav.layout.kicker')}</span>
                <h1 className="ui-title">{t('adminNav.layout.title')}</h1>
              </div>
              <div className="flex items-center gap-2">
                <Avatar name={fullName} tone="inverse" />
                <span className="ui-caption">{t('adminNav.layout.signedInAs', { firstName: user.firstName, lastName: user.lastName })}</span>
              </div>
            </header>
            {user.mfa?.enrollmentRequired && (
              <p className="pui-card px-3 py-2" role="status" style={{ borderColor: 'var(--pui-warn)' }}>
                {t('twoFactor.setup.required')}{' '}
                <Link href="/guvenlik/iki-adim?sonra=/admin" className="pui-link pui-surface ui-strong">
                  {t('twoFactor.setup.start')}
                </Link>
              </p>
            )}
            <main>{children}</main>
          </div>
        </div>
      </div>
    </div>
  );
}
