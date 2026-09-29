'use client';

import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
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
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const { data: trainers, loading, error } = useBff<TrainerRow[]>(`trainers/studio/${activeStudioId}`, activeStudioId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
          {t('screens.trainers.title')}
        </h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          {t('screens.trainers.subtitle')}
        </p>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!trainers || trainers.length === 0) && (
        <EmptyState title={t('screens.trainers.empty.title')} description={t('screens.trainers.empty.description')} />
      )}
      {!loading && !error && trainers && trainers.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {trainers.map((tr) => (
            <div
              key={tr.id}
              className="p-5 border"
              style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-card)' }}
            >
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                {tr.firstName} {tr.lastName}
              </h3>
              <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                {tr.bio || t('screens.trainers.noBio')}
              </p>
              <p className="text-xs mt-3" style={{ color: 'var(--color-text-secondary)' }}>
                {t('screens.trainers.qualifiedCount', { count: tr.qualifiedServiceTypeIds.length })}
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
