'use client';

import { useEffect, useState } from 'react';
import { isBackupErrorCode } from '@platform/shared';
import type { BackupDownloadDTO, BackupEntryDTO, BackupOverviewDTO, BackupRunDTO, BackupSettingsDTO, BackupVerifyResultDTO } from '@platform/shared';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/DataState';
import { Modal } from '@/components/common/Modal';
import { useLocale, useT } from '@/components/i18n/I18nProvider';

const card: React.CSSProperties = { borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' };
const inputStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  borderColor: 'var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};
const primaryButton: React.CSSProperties = { borderRadius: 'var(--radius-button)', backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' };
const secondaryButton: React.CSSProperties = { borderRadius: 'var(--radius-button)', borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' };
const muted: React.CSSProperties = { color: 'var(--color-text-muted)' };
const POLL_MS = 5000;

function bytesFormatter(locale: string): (n: number) => string {
  return (n: number) => {
    const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;
    let value = n;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
      value /= 1024;
      i++;
    }
    return new Intl.NumberFormat(locale, { style: 'unit', unit: units[i], unitDisplay: 'short', maximumFractionDigits: i === 0 ? 0 : 1 }).format(value);
  };
}

/** Super admin: the single console for database backups (docs/YEDEKLER.md). */
export default function AdminBackupsPage() {
  const t = useT();
  const locale = useLocale();
  const bytes = bytesFormatter(locale);
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const [refresh, setRefresh] = useState(0);
  const { data, loading, error, forbidden } = useBff<BackupOverviewDTO>('admin/backups', null, refresh);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<BackupEntryDTO | null>(null);

  const running = data?.runs.some((r) => r.status === 'RUNNING') ?? false;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setRefresh((n) => n + 1), POLL_MS);
    return () => clearInterval(id);
  }, [running]);

  if (forbidden) return <EmptyState title={t('adminBackups.accessDenied')} />;

  const fail = (err: unknown) => {
    const code = err instanceof BffError ? err.code : null;
    setNotice({ kind: 'error', text: isBackupErrorCode(code) ? t(`adminBackups.error.${code}`) : t('adminBackups.error.generic') });
  };

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const runNow = () =>
    act('run', async () => {
      await bffFetch<BackupRunDTO>('admin/backups/run', { method: 'POST' });
      setNotice({ kind: 'ok', text: t('adminBackups.run.started') });
      setRefresh((n) => n + 1);
    });

  const verify = (entry: BackupEntryDTO) =>
    act(`verify:${entry.name}`, async () => {
      const r = await bffFetch<BackupVerifyResultDTO>('admin/backups/verify', { method: 'POST', body: { name: entry.name } });
      setNotice(
        r.ok
          ? { kind: 'ok', text: t('adminBackups.verify.ok', { name: r.name, size: bytes(r.sqlBytes) }) }
          : { kind: 'error', text: t('adminBackups.verify.failed', { name: r.name, reason: t(`adminBackups.verify.reason.${r.failure}`) }) },
      );
      setRefresh((n) => n + 1);
    });

  const download = (entry: BackupEntryDTO) =>
    act(`download:${entry.name}`, async () => {
      const r = await bffFetch<BackupDownloadDTO>('admin/backups/download-url', { method: 'POST', body: { name: entry.name } });
      setNotice({ kind: 'ok', text: t('adminBackups.download.started', { minutes: Math.round((data?.config.downloadUrlTtlSeconds ?? 300) / 60) }) });
      window.location.assign(r.url);
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">{t('adminBackups.title')}</h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            {t('adminBackups.subtitle')}
          </p>
        </div>
        {data && (
          <button
            type="button"
            onClick={runNow}
            disabled={!data.config.offsiteConfigured || running || busy === 'run'}
            className="px-4 py-2 text-sm font-medium disabled:opacity-50"
            style={primaryButton}
          >
            {running || busy === 'run' ? t('adminBackups.run.running') : t('adminBackups.run.button')}
          </button>
        )}
      </div>

      {notice && (
        <p role="status" className="text-sm" style={{ color: notice.kind === 'ok' ? 'var(--color-text-secondary)' : 'var(--color-danger)' }}>
          {notice.text}
        </p>
      )}

      {loading && !data && <LoadingState />}
      {error && <ErrorState message={error} />}
      {data && (
        <>
          {!data.config.offsiteConfigured && (
            <p className="text-sm border p-4" style={{ ...card, color: 'var(--color-text-secondary)' }}>
              {t('adminBackups.notConfigured')}
            </p>
          )}
          {data.config.bucket && (
            <p className="text-xs font-mono" style={muted}>
              {t('adminBackups.storeInfo', { endpoint: data.config.endpointHost ?? '-', bucket: data.config.bucket, prefix: data.config.prefix ?? '' })}
            </p>
          )}
          {data.errors.offsite && (
            <p className="text-sm" style={{ color: 'var(--color-danger)' }}>
              {t('adminBackups.listError.offsite', { message: data.errors.offsite })}
            </p>
          )}
          {data.errors.local && (
            <p className="text-sm" style={{ color: 'var(--color-danger)' }}>
              {t('adminBackups.listError.local', { message: data.errors.local })}
            </p>
          )}

          <SummaryCards data={data} bytes={bytes} dateTime={dateTime} />
          <SettingsForm settings={data.settings} dateTime={dateTime} onSaved={() => setRefresh((n) => n + 1)} onError={fail} onNotice={setNotice} />

          <section className="space-y-2" aria-labelledby="backup-list-title">
            <h3 id="backup-list-title" className="text-sm font-semibold">
              {t('adminBackups.list.title')}
            </h3>
            {data.entries.length === 0 ? (
              <EmptyState title={t('adminBackups.list.empty')} />
            ) : (
              <div className="overflow-x-auto border" style={card}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ backgroundColor: 'var(--color-surface-muted)' }}>
                      {(['name', 'origin', 'location', 'size', 'age', 'checks', 'actions'] as const).map((col) => (
                        <th key={col} className="text-left px-3 py-2 font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                          {t(`adminBackups.col.${col}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.entries.map((e) => (
                      <tr key={e.name} className="border-t align-top" style={{ borderColor: 'var(--color-border)' }}>
                        <td className="px-3 py-2">
                          <span className="font-mono text-xs break-all">{e.name}</span>
                          <span className="block text-xs mt-0.5" style={muted}>
                            {dateTime.format(new Date(e.createdAt))}
                          </span>
                        </td>
                        <td className="px-3 py-2">{t(`adminBackups.origin.${e.origin}`)}</td>
                        <td className="px-3 py-2">{t(`adminBackups.location.${e.location}`)}</td>
                        <td className="px-3 py-2 tabular-nums whitespace-nowrap">{bytes(e.sizeBytes)}</td>
                        <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                          {e.ageHours < 48 ? t('adminBackups.age.hours', { hours: Math.round(e.ageHours) }) : t('adminBackups.age.days', { days: Math.floor(e.ageHours / 24) })}
                        </td>
                        <td className="px-3 py-2 text-xs space-y-0.5">
                          {e.offsiteKey && <span className="block">{e.sha256SidecarPresent ? t('adminBackups.check.sidecar') : t('adminBackups.check.noSidecar')}</span>}
                          {e.offsiteKey && <span className="block">{e.verifiedAt ? t('adminBackups.check.verified') : t('adminBackups.check.notVerified')}</span>}
                          {e.protected && <span className="block font-medium">{t('adminBackups.check.protected')}</span>}
                        </td>
                        <td className="px-3 py-2">
                          {e.offsiteKey && data.config.offsiteConfigured && (
                            <div className="flex flex-wrap gap-1.5">
                              <button type="button" onClick={() => verify(e)} disabled={busy !== null} className="px-2.5 py-1 text-xs border disabled:opacity-50" style={secondaryButton}>
                                {busy === `verify:${e.name}` ? t('adminBackups.action.verifying') : t('adminBackups.action.verify')}
                              </button>
                              <button type="button" onClick={() => download(e)} disabled={busy !== null} className="px-2.5 py-1 text-xs border disabled:opacity-50" style={secondaryButton}>
                                {t('adminBackups.action.download')}
                              </button>
                              {!e.protected && (
                                <button
                                  type="button"
                                  onClick={() => setDeleting(e)}
                                  disabled={busy !== null}
                                  className="px-2.5 py-1 text-xs border disabled:opacity-50"
                                  style={{ ...secondaryButton, color: 'var(--color-danger)' }}
                                >
                                  {t('adminBackups.action.delete')}
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <RunsTable runs={data.runs} bytes={bytes} dateTime={dateTime} />
        </>
      )}

      {deleting && (
        <DeleteDialog
          entry={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={(name) => {
            setDeleting(null);
            setNotice({ kind: 'ok', text: t('adminBackups.delete.done', { name }) });
            setRefresh((n) => n + 1);
          }}
          onError={(err) => {
            setDeleting(null);
            fail(err);
          }}
        />
      )}
    </div>
  );
}

function SummaryCards({ data, bytes, dateTime }: { data: BackupOverviewDTO; bytes: (n: number) => string; dateTime: Intl.DateTimeFormat }) {
  const t = useT();
  const s = data.summary.status;
  const hours = s.hoursSinceLastSuccess === null ? null : Math.floor(s.hoursSinceLastSuccess);
  const statusLabel =
    s.status === 'ok'
      ? t('adminBackups.card.ok')
      : s.status === 'stale'
        ? t('adminBackups.card.stale', { hours: hours ?? '-' })
        : s.status === 'error'
          ? t('adminBackups.card.error')
          : t('adminBackups.card.notConfigured');
  const statusColor = s.status === 'ok' ? 'var(--color-text-secondary)' : s.status === 'not_configured' ? 'var(--color-text-muted)' : 'var(--color-danger)';
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <div className="p-4 border space-y-1" style={card}>
        <h3 className="text-xs font-medium" style={muted}>
          {t('adminBackups.card.lastSuccess')}
        </h3>
        <p className="text-sm font-semibold">{s.lastSuccessAt ? dateTime.format(new Date(s.lastSuccessAt)) : t('adminBackups.card.lastSuccessNever')}</p>
        {hours !== null && (
          <p className="text-xs" style={muted}>
            {t('adminBackups.card.hoursAgo', { hours })}
          </p>
        )}
        <p className="text-xs font-medium" style={{ color: statusColor }}>
          {statusLabel}
        </p>
      </div>
      <div className="p-4 border space-y-1" style={card}>
        <h3 className="text-xs font-medium" style={muted}>
          {t('adminBackups.card.offsite')}
        </h3>
        <p className="text-sm font-semibold">
          {data.config.offsiteConfigured
            ? t('adminBackups.card.offsiteValue', { count: data.summary.offsiteCount, size: bytes(data.summary.offsiteTotalBytes) })
            : t('adminBackups.card.notConfigured')}
        </p>
      </div>
      <div className="p-4 border space-y-1" style={card}>
        <h3 className="text-xs font-medium" style={muted}>
          {t('adminBackups.card.local')}
        </h3>
        <p className="text-sm font-semibold">
          {data.config.localConfigured
            ? t('adminBackups.card.localValue', { count: data.summary.localCount, size: bytes(data.summary.localTotalBytes) })
            : t('adminBackups.card.localNotConfigured')}
        </p>
      </div>
      <div className="p-4 border space-y-1" style={card}>
        <h3 className="text-xs font-medium" style={muted}>
          {t('adminBackups.card.retention')}
        </h3>
        <p className="text-sm font-semibold">
          {data.settings.retentionDays > 0 ? t('adminBackups.card.retentionValue', { days: data.settings.retentionDays }) : t('adminBackups.card.retentionOff')}
        </p>
      </div>
    </div>
  );
}

function SettingsForm({
  settings,
  dateTime,
  onSaved,
  onError,
  onNotice,
}: {
  settings: BackupSettingsDTO;
  dateTime: Intl.DateTimeFormat;
  onSaved: () => void;
  onError: (err: unknown) => void;
  onNotice: (n: { kind: 'ok' | 'error'; text: string } | null) => void;
}) {
  const t = useT();
  const [enabled, setEnabled] = useState(settings.scheduleEnabled);
  const [time, setTime] = useState(settings.scheduleTimeUtc);
  const [retention, setRetention] = useState(String(settings.retentionDays));
  const [saving, setSaving] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    onNotice(null);
    try {
      await bffFetch<BackupSettingsDTO>('admin/backups/settings', {
        method: 'PUT',
        body: { scheduleEnabled: enabled, scheduleTimeUtc: time, retentionDays: Number(retention) },
      });
      onNotice({ kind: 'ok', text: t('adminBackups.settings.saved') });
      onSaved();
    } catch (err) {
      onError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="p-4 border space-y-3" style={card} aria-labelledby="backup-settings-title">
      <h3 id="backup-settings-title" className="text-sm font-semibold">
        {t('adminBackups.settings.title')}
      </h3>
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          {t('adminBackups.settings.enabled')}
        </label>
        <label className="text-sm space-y-1">
          <span className="block text-xs" style={muted}>
            {t('adminBackups.settings.time')}
          </span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="border px-3 py-1.5 text-sm" style={inputStyle} required />
        </label>
        <label className="text-sm space-y-1">
          <span className="block text-xs" style={muted}>
            {t('adminBackups.settings.retention')}
          </span>
          <input
            type="number"
            min={0}
            max={3650}
            value={retention}
            onChange={(e) => setRetention(e.target.value)}
            className="border px-3 py-1.5 text-sm w-28"
            style={inputStyle}
            required
          />
        </label>
        <button type="submit" disabled={saving} className="px-4 py-1.5 text-sm font-medium disabled:opacity-50" style={primaryButton}>
          {t('adminBackups.settings.save')}
        </button>
      </div>
      <p className="text-xs" style={muted}>
        {settings.nextScheduledAt ? t('adminBackups.settings.next', { value: dateTime.format(new Date(settings.nextScheduledAt)) }) : t('adminBackups.settings.nextNone')}
      </p>
      <p className="text-xs" style={muted}>
        {t('adminBackups.settings.help')}
      </p>
    </form>
  );
}

function RunsTable({ runs, bytes, dateTime }: { runs: BackupRunDTO[]; bytes: (n: number) => string; dateTime: Intl.DateTimeFormat }) {
  const t = useT();
  return (
    <section className="space-y-2" aria-labelledby="backup-runs-title">
      <h3 id="backup-runs-title" className="text-sm font-semibold">
        {t('adminBackups.runs.title')}
      </h3>
      {runs.length === 0 ? (
        <p className="text-sm" style={muted}>
          {t('adminBackups.runs.empty')}
        </p>
      ) : (
        <div className="overflow-x-auto border" style={card}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--color-surface-muted)' }}>
                {(['startedAt', 'trigger', 'status', 'size', 'detail'] as const).map((col) => (
                  <th key={col} className="text-left px-3 py-2 font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                    {t(`adminBackups.runs.col.${col}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-t align-top" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="px-3 py-2 whitespace-nowrap">{dateTime.format(new Date(r.startedAt))}</td>
                  <td className="px-3 py-2">{t(`adminBackups.runs.trigger.${r.trigger}`)}</td>
                  <td className="px-3 py-2" style={{ color: r.status === 'FAILED' ? 'var(--color-danger)' : undefined }}>
                    {t(`adminBackups.runs.status.${r.status}`)}
                  </td>
                  <td className="px-3 py-2 tabular-nums whitespace-nowrap">{r.sizeBytes === null ? '-' : bytes(r.sizeBytes)}</td>
                  <td className="px-3 py-2 text-xs break-all" style={muted}>
                    {r.error ?? r.objectKey ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function DeleteDialog({
  entry,
  onClose,
  onDeleted,
  onError,
}: {
  entry: BackupEntryDTO;
  onClose: () => void;
  onDeleted: (name: string) => void;
  onError: (err: unknown) => void;
}) {
  const t = useT();
  const [typed, setTyped] = useState('');
  const [working, setWorking] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setWorking(true);
    try {
      await bffFetch<void>('admin/backups/delete', { method: 'POST', body: { name: entry.name, confirmName: typed } });
      onDeleted(entry.name);
    } catch (err) {
      onError(err);
    } finally {
      setWorking(false);
    }
  };
  return (
    <Modal title={t('adminBackups.delete.title')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          {t('adminBackups.delete.warning')}
        </p>
        <p className="font-mono text-xs break-all">{entry.name}</p>
        <input
          aria-label={t('adminBackups.delete.confirmLabel')}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="border px-3 py-2 text-sm w-full font-mono"
          style={inputStyle}
          autoComplete="off"
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm border" style={secondaryButton}>
            {t('adminBackups.delete.cancel')}
          </button>
          <button
            type="submit"
            disabled={working || typed.trim() !== entry.name}
            className="px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            style={{ borderRadius: 'var(--radius-button)', backgroundColor: 'var(--color-danger)', color: 'var(--color-on-primary)' }}
          >
            {t('adminBackups.delete.confirm')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
