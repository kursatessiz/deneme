'use client';

import { useBff } from '@/lib/session/use-bff';
import { LoadingState, ErrorState } from '@/components/common/DataState';

interface SystemHealth {
  database: { status: string; latencyMs: number };
  redis: { status: string };
  queueDepth: number | null;
  lastHeartbeatRunAt: string | null;
  failedWebhookDeliveries: number;
  smsProvider: { provider: string; status: string; credits: number | null; threshold: number; checkedAt: string } | null;
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
  const { data, loading, error } = useBff<SystemHealth>('admin/health', null);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">Sistem Sağlığı</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          Veritabanı, kuyruk, zamanlayıcı ve SMS sağlayıcı durumu
        </p>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-5 border space-y-2" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Veritabanı</h3>
              <StatusChip ok={data.database.status === 'ok'} label={data.database.status === 'ok' ? 'Sağlıklı' : 'Hata'} />
            </div>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Gecikme: {data.database.latencyMs} ms</p>
          </div>

          <div className="p-5 border space-y-2" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Redis</h3>
              <StatusChip ok={data.redis.status !== 'error'} label={data.redis.status === 'ok' ? 'Sağlıklı' : data.redis.status === 'not_configured' ? 'Yapılandırılmamış' : 'Hata'} />
            </div>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Kuyruk derinliği: {data.queueDepth ?? '-'}</p>
          </div>

          <div className="p-5 border space-y-2" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            <h3 className="text-sm font-semibold">Zamanlayıcı (Heartbeat)</h3>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Son çalışma: {data.lastHeartbeatRunAt ? new Date(data.lastHeartbeatRunAt).toLocaleString('tr-TR') : 'Henüz çalışmadı'}
            </p>
          </div>

          <div className="p-5 border space-y-2" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Webhook Teslimatları</h3>
              <StatusChip ok={data.failedWebhookDeliveries === 0} label={`${data.failedWebhookDeliveries} başarısız`} />
            </div>
          </div>

          <div className="p-5 border space-y-2 sm:col-span-2" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">SMS Sağlayıcı Bakiyesi</h3>
              {data.smsProvider && (
                <StatusChip
                  ok={data.smsProvider.status === 'ok' || data.smsProvider.status === 'skipped'}
                  label={
                    data.smsProvider.status === 'ok'
                      ? 'Sağlıklı'
                      : data.smsProvider.status === 'low_balance'
                        ? 'Düşük bakiye'
                        : data.smsProvider.status === 'skipped'
                          ? 'MOCK sağlayıcı'
                          : 'Hata'
                  }
                />
              )}
            </div>
            {data.smsProvider ? (
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                Sağlayıcı: {data.smsProvider.provider} · Bakiye: {data.smsProvider.credits ?? '-'} · Eşik: {data.smsProvider.threshold} · Son kontrol:{' '}
                {new Date(data.smsProvider.checkedAt).toLocaleString('tr-TR')}
              </p>
            ) : (
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Henüz kontrol edilmedi (zamanlayıcı ilk çalıştığında eklenir)</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
