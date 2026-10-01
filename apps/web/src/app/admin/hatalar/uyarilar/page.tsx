'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ERROR_ALERT_KINDS } from '@platform/shared';
import type { ErrorAlertListDTO } from '@platform/shared';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/DataState';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { LinkButton } from '@/components/ui/LinkButton';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui/Table';


/** Super admin: stored error alerts (spike, new group, regression) with acknowledgement and sink delivery state (H3). */
export default function AdminErrorAlertsPage() {
  const t = useT();
  const locale = useLocale();
  const [kind, setKind] = useState('');
  const [state, setState] = useState('');
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  const params = new URLSearchParams({ page: String(page) });
  if (kind) params.set('kind', kind);
  if (state) params.set('acknowledged', state === 'acknowledged' ? 'true' : 'false');
  const { data, loading, error, forbidden } = useBff<ErrorAlertListDTO>(`admin/errors/alerts?${params.toString()}`, null, refreshKey);

  if (forbidden) return <EmptyState title={t('adminErrors.accessDenied')} />;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

  const acknowledge = async (id: string) => {
    setMessage(null);
    try {
      await bffFetch(`admin/errors/alerts/${id}/acknowledge`, { method: 'POST', body: {} });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setMessage(err instanceof BffError ? err.message : t('adminErrors.actionFailed'));
    }
  };

  return (
    <div className="grid gap-6">
      <LinkButton href="/admin/hatalar" variant="link" tone="surface" size="sm" className="justify-self-start">
        {t('adminErrors.detail.back')}
      </LinkButton>
      <PageHeader title={t('adminErrors.alerts.title')} description={t('adminErrors.alerts.subtitle')} />

      <div className="flex flex-wrap gap-3">
        <Select
          aria-label={t('adminErrors.alerts.filter.kind')}
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setPage(1);
          }}
          className="w-auto"
        >
          <option value="">{t('adminErrors.alerts.filter.all')}</option>
          {ERROR_ALERT_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`adminErrors.alert.kind.${k}`)}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('adminErrors.alerts.filter.state')}
          value={state}
          onChange={(e) => {
            setState(e.target.value);
            setPage(1);
          }}
          className="w-auto"
        >
          <option value="">{t('adminErrors.alerts.filter.all')}</option>
          <option value="open">{t('adminErrors.alerts.filter.open')}</option>
          <option value="acknowledged">{t('adminErrors.alerts.filter.acknowledged')}</option>
        </Select>
      </div>

      {message && (
        <p role="alert" className="ui-text-error">
          {message}
        </p>
      )}
      {loading && !data && <LoadingState />}
      {error && <ErrorState message={error} />}
      {data && data.items.length === 0 && <EmptyState title={t('adminErrors.alerts.empty')} />}
      {data && data.items.length > 0 && (
        <Card className="overflow-x-auto">
          <Table>
            <Thead>
              <Tr>
                {(['kind', 'group', 'count', 'at', 'delivery'] as const).map((col) => (
                  <Th key={col}>{t(`adminErrors.alerts.col.${col}`)}</Th>
                ))}
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {data.items.map((a) => (
                <Tr key={a.id} className="align-top">
                  <Td>{t(`adminErrors.alert.kind.${a.kind}`)}</Td>
                  <Td className="break-all">
                    <Link href={`/admin/hatalar/${a.groupId}`} className="pui-link pui-surface">
                      {a.groupTitle}
                    </Link>
                  </Td>
                  <Td className="tabular-nums">{a.kind === 'SPIKE' ? t('adminErrors.alerts.count', { windowCount: a.windowCount, threshold: a.threshold }) : '-'}</Td>
                  <Td className="whitespace-nowrap">{dateTime.format(new Date(a.createdAt))}</Td>
                  <Td className="ui-small">
                    {a.deliveries.length === 0
                      ? '-'
                      : a.deliveries.map((d) => (
                          <div key={d.sink}>{t('adminErrors.alerts.delivery', { sink: t(`adminErrors.alerts.sink.${d.sink}`), status: t(`adminErrors.alerts.deliveryStatus.${d.status}`) })}</div>
                        ))}
                  </Td>
                  <Td>
                    {a.acknowledgedAt ? (
                      <span className="ui-caption">{t('adminErrors.alerts.acknowledged')}</span>
                    ) : (
                      <Button variant="outline" tone="surface" size="sm" onClick={() => acknowledge(a.id)}>
                        {t('adminErrors.alerts.acknowledge')}
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Card>
      )}
      {data && pages > 1 && (
        <div className="flex items-center gap-3">
          <Button variant="outline" tone="surface" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            {t('adminErrors.page.previous')}
          </Button>
          <span className="ui-text-muted">{t('adminErrors.page.info', { page, pages, total: data.total })}</span>
          <Button variant="outline" tone="surface" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            {t('adminErrors.page.next')}
          </Button>
        </div>
      )}
    </div>
  );
}
