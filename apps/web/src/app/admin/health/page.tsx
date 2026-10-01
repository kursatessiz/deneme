'use client';

import type { BackupStatusDTO } from '@platform/shared';
import { useBff } from '@/lib/session/use-bff';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { LoadingState, ErrorState } from '@/components/common/DataState';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent } from '@/components/ui/Card';
import { LinkButton } from '@/components/ui/LinkButton';
import { PageHeader } from '@/components/ui/PageHeader';

interface SystemHealth {
  database: { status: string; latencyMs: number };
  redis: { status: string };
  queueDepth: number | null;
  lastHeartbeatRunAt: string | null;
  failedWebhookDeliveries: number;
  smsProvider: { provider: string; status: string; credits: number | null; threshold: number; checkedAt: string } | null;
  backup: BackupStatusDTO;
}

function StatusChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Badge variant={ok ? 'soft' : 'solid'} tone={ok ? 'muted' : 'error'}>
      {label}
    </Badge>
  );
}

export default function SystemHealthPage() {
  const locale = useLocale();
  const t = useT();
  const { data, loading, error } = useBff<SystemHealth>('admin/health', null);

  return (
    <div className="grid gap-6">
      <PageHeader title={t('adminHealth.title')} description={t('adminHealth.subtitle')} />

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card>
            <CardContent>
              <div className="flex items-center justify-between gap-2">
                <h3 className="ui-heading">{t('adminHealth.database.title')}</h3>
                <StatusChip ok={data.database.status === 'ok'} label={data.database.status === 'ok' ? t('adminHealth.database.healthy') : t('adminHealth.database.error')} />
              </div>
              <p className="ui-caption">{t('adminHealth.database.latency', { ms: data.database.latencyMs })}</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <div className="flex items-center justify-between gap-2">
                <h3 className="ui-heading">{t('adminHealth.redis.title')}</h3>
                <StatusChip
                  ok={data.redis.status !== 'error'}
                  label={data.redis.status === 'ok' ? t('adminHealth.redis.healthy') : data.redis.status === 'not_configured' ? t('adminHealth.redis.notConfigured') : t('adminHealth.redis.error')}
                />
              </div>
              <p className="ui-caption">{t('adminHealth.redis.queueDepth', { value: data.queueDepth ?? '-' })}</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <h3 className="ui-heading">{t('adminHealth.heartbeat.title')}</h3>
              <p className="ui-caption">
                {t('adminHealth.heartbeat.lastRun', {
                  value: data.lastHeartbeatRunAt ? new Date(data.lastHeartbeatRunAt).toLocaleString(locale) : t('adminHealth.heartbeat.neverRun'),
                })}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <div className="flex items-center justify-between gap-2">
                <h3 className="ui-heading">{t('adminHealth.webhooks.title')}</h3>
                <StatusChip ok={data.failedWebhookDeliveries === 0} label={t('adminHealth.webhooks.failed', { count: data.failedWebhookDeliveries })} />
              </div>
            </CardContent>
          </Card>

          <Card className="sm:col-span-2">
            <CardContent>
              <div className="flex items-center justify-between gap-2">
                <h3 className="ui-heading">{t('adminHealth.smsProvider.title')}</h3>
                {data.smsProvider && (
                  <StatusChip
                    ok={data.smsProvider.status === 'ok' || data.smsProvider.status === 'skipped'}
                    label={
                      data.smsProvider.status === 'ok'
                        ? t('adminHealth.smsProvider.healthy')
                        : data.smsProvider.status === 'low_balance'
                          ? t('adminHealth.smsProvider.lowBalance')
                          : data.smsProvider.status === 'skipped'
                            ? t('adminHealth.smsProvider.mock')
                            : t('adminHealth.smsProvider.error')
                    }
                  />
                )}
              </div>
              {data.smsProvider ? (
                <p className="ui-caption">
                  {t('adminHealth.smsProvider.summary', {
                    provider: data.smsProvider.provider,
                    balance: data.smsProvider.credits ?? '-',
                    threshold: data.smsProvider.threshold,
                    checkedAt: new Date(data.smsProvider.checkedAt).toLocaleString(locale),
                  })}
                </p>
              ) : (
                <p className="ui-caption">{t('adminHealth.smsProvider.neverChecked')}</p>
              )}
            </CardContent>
          </Card>

          <Card className="sm:col-span-2">
            <CardContent>
              <div className="flex items-center justify-between gap-2">
                <h3 className="ui-heading">{t('adminHealth.backup.title')}</h3>
                <StatusChip
                  ok={data.backup.status === 'ok' || data.backup.status === 'not_configured'}
                  label={
                    data.backup.status === 'ok'
                      ? t('adminHealth.backup.ok')
                      : data.backup.status === 'stale'
                        ? t('adminHealth.backup.stale')
                        : data.backup.status === 'error'
                          ? t('adminHealth.backup.error')
                          : t('adminHealth.backup.notConfigured')
                  }
                />
              </div>
              <p className="ui-caption">
                {t('adminHealth.backup.summary', {
                  value: data.backup.lastSuccessAt ? new Date(data.backup.lastSuccessAt).toLocaleString(locale) : t('adminHealth.backup.never'),
                  threshold: data.backup.staleAfterHours,
                })}
              </p>
              <LinkButton href="/admin/yedekler" variant="link" size="sm" className="justify-self-start">
                {t('adminHealth.backup.link')}
              </LinkButton>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
