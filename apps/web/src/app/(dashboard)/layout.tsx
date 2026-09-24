import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import type { BranchDTO } from '@platform/shared';
import { getServerSession } from '@/lib/session/server-session';
import { serverGet } from '@/lib/session/server-fetch';
import { ACCESS_TOKEN_COOKIE } from '@/lib/bff/cookies';
import { ThemeRoot } from '@/components/theme/ThemeRoot';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { ALL_FONT_VARIABLE_CLASSES } from '@/lib/fonts';
import { DashboardSessionProvider } from '@/components/session/DashboardSessionProvider';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  if (!session) redirect('/giris');

  const { user, activeMembership, activeStudioId, activeBranchId } = session;
  const jar = await cookies();
  const accessToken = jar.get(ACCESS_TOKEN_COOKIE)!.value;
  const branches = (await serverGet<BranchDTO[]>(`branches/studio/${activeStudioId}`, accessToken, activeStudioId)) ?? [];

  return (
    <div className={ALL_FONT_VARIABLE_CLASSES}>
      <ThemeRoot tenantTheme={activeMembership.theme} appearance={user.appearance}>
        <div className="flex min-h-screen">
          <Sidebar memberships={user.memberships} activeMembership={activeMembership} logoUrl={activeMembership.theme.logoUrl} />
          <div className="flex-1 flex flex-col min-w-0">
            <Header
              userName={`${user.firstName} ${user.lastName}`}
              membership={activeMembership}
              branches={branches}
              activeBranchId={activeBranchId}
            />
            <main className="flex-1 p-6 md:p-8 max-w-7xl w-full mx-auto">
              <DashboardSessionProvider
                value={{ activeStudioId, permissions: activeMembership.permissions, isOwner: activeMembership.isOwner }}
              >
                {children}
              </DashboardSessionProvider>
            </main>
          </div>
        </div>
      </ThemeRoot>
    </div>
  );
}
