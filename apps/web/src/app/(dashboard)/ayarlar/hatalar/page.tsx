'use client';

import { useEffect, useState } from 'react';
import type { StudioErrorGroupDTO, StudioErrorSettingsDTO } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { useBff } from '@/lib/session/use-bff';
import { BffError, bffFetch } from '@/lib/session/client';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/DataState';
import { PageGuard } from '@/components/common/PageGuard';
import { SettingsHeader } from '@/components/settings/ui';
import { Card, CardContent } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui/Table';

function ErrorList() {
  const t = useT();
  const locale = useLocale();
  const { activeStudioId } = useDashboardSession();
  const { data, loading, error } = useBff<StudioErrorGroupDTO[]>(activeStudioId ? `studios/${activeStudioId}/errors` : null, activeStudioId);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!data || data.length === 0) return <EmptyState title={t('errors.owner.empty')} />;

  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <Card className="overflow-x-auto">
      <Table>
        <Thead>
          <Tr>
            {(['message', 'source', 'count', 'firstSeen', 'lastSeen', 'code', 'status'] as const).map((col) => (
              <Th key={col}>{t(`errors.owner.col.${col}`)}</Th>
            ))}
          </Tr>
        </Thead>
        <Tbody>
          {data.map((g) => (
            <Tr key={g.id} className="align-top">
              <Td className="break-all">{g.safeMessage ?? t('errors.owner.serverError')}</Td>
              <Td>{t(`errors.source.${g.source}`)}</Td>
              <Td className="tabular-nums">{new Intl.NumberFormat(locale).format(g.count)}</Td>
              <Td className="whitespace-nowrap">{dateTime.format(new Date(g.firstSeenAt))}</Td>
              <Td className="whitespace-nowrap">{dateTime.format(new Date(g.lastSeenAt))}</Td>
              <Td className="ui-mono">{g.lastCode ?? '-'}</Td>
              <Td>{t(`errors.status.${g.status}`)}</Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </Card>
  );
}

/** Opt-in e-mail to the owner about new error groups and spikes that affect this studio's users (H3). */
function NotifyToggle() {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const { data } = useBff<StudioErrorSettingsDTO>(activeStudioId ? `studios/${activeStudioId}/errors/settings` : null, activeStudioId);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (data) setEnabled(data.ownerNotify);
  }, [data]);

  if (!activeStudioId || !data) return null;
  const change = async (next: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      await bffFetch(`studios/${activeStudioId}/errors/settings`, { method: 'PATCH', body: { ownerNotify: next }, studioId: activeStudioId });
      setEnabled(next);
      setMessage(t('errors.owner.notify.saved'));
    } catch (err) {
      setMessage(err instanceof BffError ? err.message : t('errors.owner.notify.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card as="section">
      <CardContent>
        <h3 className="ui-heading">{t('errors.owner.notify.title')}</h3>
        <p className="ui-text-muted">{t('errors.owner.notify.description')}</p>
        <Checkbox label={t('errors.owner.notify.toggle')} checked={enabled} disabled={busy} onChange={(e) => change(e.target.checked)} />
        {message && (
          <p role="status" className="ui-caption">
            {message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Tenant owner view of the studio's own errors (H1): safe message, code, counts; no stack traces. */
export default function StudioErrorsPage() {
  const t = useT();
  return (
    <PageGuard required={['errors.view']}>
      <div className="grid gap-6">
        <SettingsHeader title={t('errors.owner.title')} description={t('errors.owner.description')} />
        <NotifyToggle />
        <ErrorList />
      </div>
    </PageGuard>
  );
}
