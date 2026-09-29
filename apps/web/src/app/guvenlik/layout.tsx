import { redirect } from 'next/navigation';
import { AdminTheme } from '@/components/admin/AdminTheme';
import { getSessionUser } from '@/lib/session/admin-session';

/** Neutral shell for account security screens (M1 two-step verification); needs a session, no tenant. */
export default async function SecurityLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/giris');
  return (
    <div className="admin-root">
      <AdminTheme />
      <main className="max-w-lg mx-auto px-4 py-12">{children}</main>
    </div>
  );
}
