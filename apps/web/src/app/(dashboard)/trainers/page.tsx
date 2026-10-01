'use client';

import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { useBff } from '@/lib/session/use-bff';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { PageGuard } from '@/components/common/PageGuard';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';

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
    <div className="grid gap-6">
      <PageHeader title={t('screens.trainers.title')} description={t('screens.trainers.subtitle')} />

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!trainers || trainers.length === 0) && (
        <EmptyState title={t('screens.trainers.empty.title')} description={t('screens.trainers.empty.description')} />
      )}
      {!loading && !error && trainers && trainers.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {trainers.map((tr) => (
            <Card key={tr.id} className="grid gap-2 p-5">
              <h3 className="ui-heading">
                {tr.firstName} {tr.lastName}
              </h3>
              <p className="ui-caption">{tr.bio || t('screens.trainers.noBio')}</p>
              <p className="ui-caption">{t('screens.trainers.qualifiedCount', { count: tr.qualifiedServiceTypeIds.length })}</p>
            </Card>
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
