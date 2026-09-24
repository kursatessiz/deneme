import { redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/session/admin-session';
import { AdminTheme } from '@/components/admin/AdminTheme';
import { AdminNav } from '@/components/admin/AdminNav';

/**
 * `/admin` route group: the super-admin (platform owner) panel, backlog
 * 4.1-4.3. Visible only when the session user is isSuperAdmin - checked
 * here, server-side, in addition to the API's SuperAdminGuard on every
 * /admin/* endpoint (CLAUDE.md security note: the real boundary is the API
 * guard, this is defense in depth for the page shell).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getAdminSession();
  if (!user) redirect('/giris?sonra=/admin');

  return (
    <div className="admin-root">
      <AdminTheme />
      <div className="max-w-6xl mx-auto px-4 py-8">
        <header className="mb-6">
          <p className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
            Platform Yönetimi
          </p>
          <h1 className="text-2xl font-bold tracking-tight mt-1">Süper Admin Paneli</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            {user.firstName} {user.lastName} olarak oturum açtınız
          </p>
        </header>
        <AdminNav />
        <main>{children}</main>
      </div>
    </div>
  );
}
