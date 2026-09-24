'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { MembershipDTO } from '@platform/shared';
import { filterNavByPermissions, NAV_ITEMS } from '@/lib/nav';
import { setActiveStudioCookie } from '@/lib/session/active-selection';

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
  const items = filterNavByPermissions(NAV_ITEMS, activeMembership.permissions, activeMembership.isOwner);

  function switchStudio(studioId: string) {
    if (studioId === activeMembership.studioId) return;
    setActiveStudioCookie(studioId);
    router.refresh();
  }

  return (
    <aside
      className="w-64 flex flex-col shrink-0 min-h-screen border-r"
      style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      <div
        className="p-6 flex items-center space-x-3"
        style={{ background: 'var(--gradient-brand)', borderRadius: '0 0 var(--radius-card) 0' }}
      >
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- tenant logo, arbitrary remote host
          <img src={logoUrl} alt="" className="w-10 h-10 rounded-xl object-cover bg-white/10" />
        ) : (
          <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center font-bold text-white">
            {activeMembership.studioName.slice(0, 1)}
          </div>
        )}
        <div>
          <h1 className="font-semibold tracking-tight" style={{ color: 'var(--color-on-primary, #fff)' }}>
            {activeMembership.studioName}
          </h1>
          <p className="text-xs font-medium opacity-90" style={{ color: 'var(--color-on-primary, #fff)' }}>
            Yönetim Paneli
          </p>
        </div>
      </div>

      {memberships.length > 1 && (
        <div className="px-4 py-3 mx-3 my-4 rounded-xl border" style={{ borderColor: 'var(--color-border)' }}>
          <label className="text-[10px] font-semibold tracking-wider uppercase block mb-1" style={{ color: 'var(--color-text-muted)' }}>
            Aktif İşletme
          </label>
          <select
            value={activeMembership.studioId}
            onChange={(e) => switchStudio(e.target.value)}
            className="w-full bg-transparent text-sm font-medium outline-none"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {memberships.map((m) => (
              <option key={m.studioId} value={m.studioId}>
                {m.studioName}
              </option>
            ))}
          </select>
        </div>
      )}

      <nav className="flex-1 px-3 space-y-1 mt-2">
        {items.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.key}
              href={item.href}
              className="flex items-center px-3 py-2.5 text-sm font-medium transition-colors"
              style={{
                borderRadius: 'var(--radius-button)',
                backgroundColor: isActive ? 'var(--color-primary)' : 'transparent',
                color: isActive ? 'var(--color-on-primary)' : 'var(--color-text-secondary)',
              }}
            >
              <Icon className="w-5 h-5 mr-3" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 text-xs" style={{ color: 'var(--color-text-muted)' }}>
        {activeMembership.roleName}
      </div>
    </aside>
  );
}
