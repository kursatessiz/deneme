'use client';

import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import type { BranchDTO, MembershipDTO } from '@platform/shared';
import { setActiveBranchCookie } from '@/lib/session/active-selection';
import { bffFetch } from '@/lib/session/client';

export function Header({
  userName,
  membership,
  branches,
  activeBranchId,
}: {
  userName: string;
  membership: MembershipDTO;
  branches: BranchDTO[];
  activeBranchId: string | null;
}) {
  const router = useRouter();
  const today = new Date().toLocaleDateString('tr-TR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  function switchBranch(branchId: string) {
    setActiveBranchCookie(branchId);
    router.refresh();
  }

  async function signOut() {
    try {
      await bffFetch('auth/logout', { method: 'POST' });
    } finally {
      router.push('/giris');
      router.refresh();
    }
  }

  const initials = userName
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <header
      className="h-16 border-b px-6 flex items-center justify-between sticky top-0 z-30"
      style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      <div className="flex items-center space-x-3 text-sm" style={{ color: 'var(--color-text-muted)' }}>
        <span className="font-medium capitalize" style={{ color: 'var(--color-text-secondary)' }}>
          {today}
        </span>
      </div>

      <div className="flex items-center space-x-4">
        {branches.length > 1 && (
          <select
            value={activeBranchId ?? ''}
            onChange={(e) => switchBranch(e.target.value)}
            className="text-xs rounded-lg border px-2.5 py-1.5 outline-none"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-primary)', backgroundColor: 'var(--color-surface-muted)' }}
          >
            <option value="">Tüm şubeler</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}

        <div className="flex items-center space-x-3 pl-3 border-l" style={{ borderColor: 'var(--color-border)' }}>
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center font-medium text-sm"
            style={{ backgroundColor: 'var(--color-surface-muted)', color: 'var(--color-text-secondary)' }}
          >
            {initials}
          </div>
          <div className="text-left hidden sm:block">
            <p className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              {userName}
            </p>
            <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
              {membership.roleName}
            </p>
          </div>
          <button
            title="Çıkış yap"
            aria-label="Çıkış yap"
            onClick={signOut}
            className="p-2 rounded-lg"
            style={{ color: 'var(--color-text-muted)' }}
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
