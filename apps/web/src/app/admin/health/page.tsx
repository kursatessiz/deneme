'use client';

import Link from 'next/link';
import type { BackupStatusDTO } from '@platform/shared';
import { useBff } from '@/lib/session/use-bff';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { LoadingState, ErrorState } from '@/components/common/DataState';

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
    <span
      className="px-2 py-0.5 text-xs font-medium"
      style={{
        borderRadius: 'var(--radius-chip)',
        backgroundColor: ok ? 'var(--color-surface-muted)' : 'var(--color-danger)',
        color: ok ? 'var(--color-text-secondary)' : 'var(--color-on-primary)',
      }}
    >
      {label}
    </span>
  );
}

export default function SystemHealthPage() {
  const locale = useLocale();
  const t = useT();
  const { data, loading, error } = useBff<SystemHealth>('admin/health', null);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">{t('adminHealth.title')}</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          {t('adminHealth.subtitle')}
        </p>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-5 border space-y-2" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{t('adminHealth.database.title')}</h3>
              <StatusChip ok={data.database.status === 'ok'} label={data.database.status === 'ok' ? t('adminHealth.database.healthy') : t('adminHealth.database.error')} />
            </div>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('adminHealth.database.latency', { ms: data.database.latencyMs })}</p>
          </div>

          <div className="p-5 border space-y-2" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{t('adminHealth.redis.title')}</h3>
              <StatusChip
                ok={data.redis.status !== 'error'}
                label={data.redis.status === 'ok' ? t('adminHealth.redis.healthy') : data.redis.status === 'not_configured' ? t('adminHealth.redis.notConfigured') : t('adminHealth.redis.error')}
              />
            </div>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('adminHealth.redis.queueDepth', { value: data.queueDepth ?? '-' })}</p>
          </div>

          <div className="p-5 border space-y-2" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            <h3 className="text-sm font-semibold">{t('adminHealth.heartbeat.title')}</h3>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {t('adminHealth.heartbeat.lastRun', {
                value: data.lastHeartbeatRunAt ? new Date(data.lastHeartbeatRunAt).toLocaleString(locale) : t('adminHealth.heartbeat.neverRun'),
              })}
            </p>
          </div>

          <div className="p-5 border space-y-2" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{t('adminHealth.webhooks.title')}</h3>
              <StatusChip ok={data.failedWebhookDeliveries === 0} label={t('adminHealth.webhooks.failed', { count: data.failedWebhookDeliveries })} />
            </div>
          </div>

          <div className="p-5 border space-y-2 sm:col-span-2" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{t('adminHealth.smsProvider.title')}</h3>
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
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {t('adminHealth.smsProvider.summary', {
                  provider: data.smsProvider.provider,
                  balance: data.smsProvider.credits ?? '-',
                  threshold: data.smsProvider.threshold,
                  checkedAt: new Date(data.smsProvider.checkedAt).toLocaleString(locale),
                })}
              </p>
            ) : (
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('adminHealth.smsProvider.neverChecked')}</p>
            )}
          </div>

          <div className="p-5 border space-y-2 sm:col-span-2" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{t('adminHealth.backup.title')}</h3>
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
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {t('adminHealth.backup.summary', {
                value: data.backup.lastSuccessAt ? new Date(data.backup.lastSuccessAt).toLocaleString(locale) : t('adminHealth.backup.never'),
                threshold: data.backup.staleAfterHours,
              })}
            </p>
            <Link href="/admin/yedekler" className="text-xs font-medium hover:underline">
              {t('adminHealth.backup.link')}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
