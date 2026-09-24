'use client';

import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useBff } from '@/lib/session/use-bff';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { PageGuard } from '@/components/common/PageGuard';

interface MemberRow {
  id: string;
  firstName: string;
  lastName: string;
  phone?: string;
  bookingsCount?: number;
  packages?: { id: string }[];
}

function MembersList() {
  const { activeStudioId } = useDashboardSession();
  const { data: members, loading, error } = useBff<MemberRow[]>(`members/studio/${activeStudioId}`, activeStudioId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
          Üyeler
        </h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          Kayıtlı üyeler ve aktif paketleri
        </p>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!members || members.length === 0) && (
        <EmptyState title="Henüz üye yok" description="Üye eklendikçe burada listelenecek." />
      )}
      {!loading && !error && members && members.length > 0 && (
        <div className="border overflow-hidden" style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-card)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--color-surface-muted)' }}>
                <th className="text-left px-4 py-2.5 font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                  Ad Soyad
                </th>
                <th className="text-left px-4 py-2.5 font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                  Telefon
                </th>
                <th className="text-left px-4 py-2.5 font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                  Aktif Paket
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-t" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                  <td className="px-4 py-2.5" style={{ color: 'var(--color-text-primary)' }}>
                    {m.firstName} {m.lastName}
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--color-text-secondary)' }}>
                    {m.phone ?? '—'}
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--color-text-secondary)' }}>
                    {m.packages && m.packages.length > 0 ? m.packages.length : 'Yok'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function MembersPage() {
  return (
    <PageGuard required={['members.view']}>
      <MembersList />
    </PageGuard>
  );
}
