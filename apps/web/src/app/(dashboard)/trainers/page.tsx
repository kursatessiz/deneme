'use client';

import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useBff } from '@/lib/session/use-bff';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { PageGuard } from '@/components/common/PageGuard';

interface TrainerRow {
  id: string;
  firstName: string;
  lastName: string;
  bio?: string | null;
  qualifiedServiceTypeIds: string[];
}

function TrainersList() {
  const { activeStudioId } = useDashboardSession();
  const { data: trainers, loading, error } = useBff<TrainerRow[]>(`trainers/studio/${activeStudioId}`, activeStudioId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
          Eğitmenler
        </h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          Kadroda yer alan eğitmenler
        </p>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!trainers || trainers.length === 0) && (
        <EmptyState title="Henüz eğitmen yok" description="Personel davet edildikçe burada listelenecek." />
      )}
      {!loading && !error && trainers && trainers.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {trainers.map((t) => (
            <div
              key={t.id}
              className="p-5 border"
              style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-card)' }}
            >
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                {t.firstName} {t.lastName}
              </h3>
              <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                {t.bio || 'Açıklama eklenmemiş'}
              </p>
              <p className="text-xs mt-3" style={{ color: 'var(--color-text-secondary)' }}>
                {t.qualifiedServiceTypeIds.length} hizmet türünde yetkili
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TrainersPage() {
  return (
    <PageGuard required={['schedule.view']}>
      <TrainersList />
    </PageGuard>
  );
}
