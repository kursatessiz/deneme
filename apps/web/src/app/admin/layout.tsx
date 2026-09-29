import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSessionUser, twoFactorRedirect } from '@/lib/session/admin-session';
import { AdminTheme } from '@/components/admin/AdminTheme';
import { AdminNav } from '@/components/admin/AdminNav';
import { getT } from '@/lib/i18n/getT';

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

  return (
    <div className="admin-root">
      <AdminTheme />
      <div className="max-w-6xl mx-auto px-4 py-8">
        <header className="mb-6">
          <p className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
            {t('adminNav.layout.kicker')}
          </p>
          <h1 className="text-2xl font-bold tracking-tight mt-1">{t('adminNav.layout.title')}</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            {t('adminNav.layout.signedInAs', { firstName: user.firstName, lastName: user.lastName })}
          </p>
        </header>
        {user.mfa?.enrollmentRequired && (
          <p className="mb-4 text-sm border px-3 py-2" role="status" style={{ borderColor: 'var(--color-warning)', borderRadius: 'var(--radius-card)' }}>
            {t('twoFactor.setup.required')}{' '}
            <Link href="/guvenlik/iki-adim?sonra=/admin" className="underline font-medium">
              {t('twoFactor.setup.start')}
            </Link>
          </p>
        )}
        <AdminNav />
        <main>{children}</main>
      </div>
    </div>
  );
}
