'use client';

import type { BranchDTO } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useBff } from '@/lib/session/use-bff';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';

export default function DashboardPage() {
  const { activeStudioId } = useDashboardSession();
  const { data: branches, loading, error } = useBff<BranchDTO[]>(`branches/studio/${activeStudioId}`, activeStudioId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
          Genel Bakış
        </h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          İşletmenizin güncel durumu
        </p>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!branches || branches.length === 0) && (
        <EmptyState title="Henüz veri yok" description="Şube ve seans verileri geldikçe burada özetlenecek." />
      )}
      {!loading && !error && branches && branches.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {branches.map((branch) => (
            <div
              key={branch.id}
              className="p-5 border"
              style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-card)' }}
            >
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                {branch.name}
              </h3>
              <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                {branch.address ?? 'Adres tanımlı değil'}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
