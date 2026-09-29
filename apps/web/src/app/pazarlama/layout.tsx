import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AdminTheme } from '@/components/admin/AdminTheme';
import { DashboardSessionProvider } from '@/components/session/DashboardSessionProvider';
import { AreaBaseProvider } from '@/components/session/AreaBase';
import { PlatformSessionProvider } from '@/components/marketing/PlatformSession';
import { MarketingNav } from '@/components/marketing/MarketingNav';
import { getPlatformContext, getSessionUser, twoFactorRedirect } from '@/lib/session/admin-session';
import { getT } from '@/lib/i18n/getT';

/**
 * `/pazarlama/*`: the platform's own marketing panel (docs/PAZARLAMA_MODULU.md
 * 3.1), for the super admin and platform members. It binds the reused
 * `(dashboard)` screens to the platform tenant through
 * DashboardSessionProvider (tenant permissions derived via
 * PLATFORM_TENANT_GRANTS) and prefixes their links with AreaBaseProvider.
 * Server-side checks here are defense in depth; the API's
 * PlatformPermissionGuard and StudioTenantGuard are the boundary.
 */
export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/giris?sonra=/pazarlama');
  if (!user.isSuperAdmin && !user.platformAccess) redirect('/dashboard');
  const mfaTarget = twoFactorRedirect(user, '/pazarlama');
  if (mfaTarget) redirect(mfaTarget);

  const { t } = await getT();
  const context = await getPlatformContext();

  return (
    <div className="admin-root">
      <AdminTheme />
      <div className="max-w-6xl mx-auto px-4 py-8">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
              {t('marketing.layout.kicker')}
            </p>
            <h1 className="text-2xl font-bold tracking-tight mt-1">{t('marketing.layout.title')}</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
              {t('marketing.layout.signedInAs', { firstName: user.firstName, lastName: user.lastName })}
            </p>
          </div>
          <div className="flex gap-3 text-sm">
            <Link href="/guvenlik/iki-adim?sonra=/pazarlama" className="underline" style={{ color: 'var(--color-text-secondary)' }}>
              {t('marketing.layout.security')}
            </Link>
            {user.isSuperAdmin && (
              <Link href="/admin" className="underline" style={{ color: 'var(--color-text-secondary)' }}>
                {t('marketing.layout.backToAdmin')}
              </Link>
            )}
          </div>
        </header>
        {context ? (
          <PlatformSessionProvider
            value={{ platformStudioId: context.platformStudioId, permissions: context.permissions, isSuperAdmin: context.isSuperAdmin }}
          >
            <MarketingNav />
            <main>
              <DashboardSessionProvider
                value={{
                  activeStudioId: context.platformStudioId,
                  permissions: context.tenantPermissions,
                  isOwner: false,
                  currency: context.currency,
                }}
              >
                <AreaBaseProvider basePath="/pazarlama">{children}</AreaBaseProvider>
              </DashboardSessionProvider>
            </main>
          </PlatformSessionProvider>
        ) : (
          <main>
            <p className="text-sm" role="alert" style={{ color: 'var(--color-danger)' }}>
              {t('marketing.layout.contextFailed')}
            </p>
          </main>
        )}
      </div>
    </div>
  );
}
