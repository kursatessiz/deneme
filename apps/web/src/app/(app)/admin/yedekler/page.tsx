'use client';

import { useEffect, useState } from 'react';
import { isBackupErrorCode } from '@platform/shared';
import type { BackupDownloadDTO, BackupEntryDTO, BackupOverviewDTO, BackupRunDTO, BackupSettingsDTO, BackupVerifyResultDTO } from '@platform/shared';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/DataState';
import { Modal } from '@/components/common/Modal';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { FieldGroup } from '@/components/ui/FieldGroup';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui/Table';

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
    <div className="grid gap-6">
      <PageHeader
        title={t('adminBackups.title')}
        description={t('adminBackups.subtitle')}
        actions={
          data && (
            <Button onClick={runNow} disabled={!data.config.offsiteConfigured || running || busy === 'run'}>
              {running || busy === 'run' ? t('adminBackups.run.running') : t('adminBackups.run.button')}
            </Button>
          )
        }
      />

      {notice && (
        <p role="status" className={notice.kind === 'ok' ? 'ui-text-muted' : 'ui-text-error'}>
          {notice.text}
        </p>
      )}

      {loading && !data && <LoadingState />}
      {error && <ErrorState message={error} />}
      {data && (
        <>
          {!data.config.offsiteConfigured && (
            <p className="ui-panel ui-text-muted p-4">{t('adminBackups.notConfigured')}</p>
          )}
          {data.config.bucket && (
            <p className="ui-caption ui-mono">
              {t('adminBackups.storeInfo', { endpoint: data.config.endpointHost ?? '-', bucket: data.config.bucket, prefix: data.config.prefix ?? '' })}
            </p>
          )}
          {data.errors.offsite && <p className="ui-text-error">{t('adminBackups.listError.offsite', { message: data.errors.offsite })}</p>}
          {data.errors.local && <p className="ui-text-error">{t('adminBackups.listError.local', { message: data.errors.local })}</p>}

          <SummaryCards data={data} bytes={bytes} dateTime={dateTime} />
          <SettingsForm settings={data.settings} dateTime={dateTime} onSaved={() => setRefresh((n) => n + 1)} onError={fail} onNotice={setNotice} />

          <section className="grid gap-2" aria-labelledby="backup-list-title">
            <h3 id="backup-list-title" className="ui-heading">
              {t('adminBackups.list.title')}
            </h3>
            {data.entries.length === 0 ? (
              <EmptyState title={t('adminBackups.list.empty')} />
            ) : (
              <Card className="overflow-x-auto">
                <Table>
                  <Thead>
                    <Tr>
                      {(['name', 'origin', 'location', 'size', 'age', 'checks', 'actions'] as const).map((col) => (
                        <Th key={col}>{t(`adminBackups.col.${col}`)}</Th>
                      ))}
                    </Tr>
                  </Thead>
                  <Tbody>
                    {data.entries.map((e) => (
                      <Tr key={e.name} className="align-top">
                        <Td>
                          <span className="ui-mono break-all">{e.name}</span>
                          <span className="block ui-caption">{dateTime.format(new Date(e.createdAt))}</span>
                        </Td>
                        <Td>{t(`adminBackups.origin.${e.origin}`)}</Td>
                        <Td>{t(`adminBackups.location.${e.location}`)}</Td>
                        <Td className="tabular-nums whitespace-nowrap">{bytes(e.sizeBytes)}</Td>
                        <Td className="tabular-nums whitespace-nowrap">
                          {e.ageHours < 48 ? t('adminBackups.age.hours', { hours: Math.round(e.ageHours) }) : t('adminBackups.age.days', { days: Math.floor(e.ageHours / 24) })}
                        </Td>
                        <Td className="ui-small">
                          {e.offsiteKey && <span className="block">{e.sha256SidecarPresent ? t('adminBackups.check.sidecar') : t('adminBackups.check.noSidecar')}</span>}
                          {e.offsiteKey && <span className="block">{e.verifiedAt ? t('adminBackups.check.verified') : t('adminBackups.check.notVerified')}</span>}
                          {e.protected && <span className="block ui-strong">{t('adminBackups.check.protected')}</span>}
                        </Td>
                        <Td>
                          {e.offsiteKey && data.config.offsiteConfigured && (
                            <div className="flex flex-wrap gap-1.5">
                              <Button variant="outline" tone="surface" size="sm" onClick={() => verify(e)} disabled={busy !== null}>
                                {busy === `verify:${e.name}` ? t('adminBackups.action.verifying') : t('adminBackups.action.verify')}
                              </Button>
                              <Button variant="outline" tone="surface" size="sm" onClick={() => download(e)} disabled={busy !== null}>
                                {t('adminBackups.action.download')}
                              </Button>
                              {!e.protected && (
                                <Button variant="outline" tone="error" size="sm" onClick={() => setDeleting(e)} disabled={busy !== null}>
                                  {t('adminBackups.action.delete')}
                                </Button>
                              )}
                            </div>
                          )}
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </Card>
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
  const statusClass = s.status === 'ok' ? 'ui-small ui-strong ui-text-muted' : s.status === 'not_configured' ? 'ui-small ui-strong ui-text-muted' : 'ui-small ui-strong ui-text-error';
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <Card>
        <CardContent>
          <h3 className="ui-caption">{t('adminBackups.card.lastSuccess')}</h3>
          <p className="ui-strong">{s.lastSuccessAt ? dateTime.format(new Date(s.lastSuccessAt)) : t('adminBackups.card.lastSuccessNever')}</p>
          {hours !== null && <p className="ui-caption">{t('adminBackups.card.hoursAgo', { hours })}</p>}
          <p className={statusClass}>{statusLabel}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <h3 className="ui-caption">{t('adminBackups.card.offsite')}</h3>
          <p className="ui-strong">
            {data.config.offsiteConfigured
              ? t('adminBackups.card.offsiteValue', { count: data.summary.offsiteCount, size: bytes(data.summary.offsiteTotalBytes) })
              : t('adminBackups.card.notConfigured')}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <h3 className="ui-caption">{t('adminBackups.card.local')}</h3>
          <p className="ui-strong">
            {data.config.localConfigured
              ? t('adminBackups.card.localValue', { count: data.summary.localCount, size: bytes(data.summary.localTotalBytes) })
              : t('adminBackups.card.localNotConfigured')}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <h3 className="ui-caption">{t('adminBackups.card.retention')}</h3>
          <p className="ui-strong">
            {data.settings.retentionDays > 0 ? t('adminBackups.card.retentionValue', { days: data.settings.retentionDays }) : t('adminBackups.card.retentionOff')}
          </p>
        </CardContent>
      </Card>
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
    <form onSubmit={save} className="pui-card" aria-labelledby="backup-settings-title">
      <div className="pui-card-content">
        <h3 id="backup-settings-title" className="ui-heading">
          {t('adminBackups.settings.title')}
        </h3>
        <div className="flex flex-wrap items-end gap-4">
          <Checkbox label={t('adminBackups.settings.enabled')} checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <FieldGroup label={t('adminBackups.settings.time')}>
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
          </FieldGroup>
          <FieldGroup label={t('adminBackups.settings.retention')}>
            <Input type="number" min={0} max={3650} value={retention} onChange={(e) => setRetention(e.target.value)} className="w-28" required />
          </FieldGroup>
          <Button type="submit" disabled={saving}>
            {t('adminBackups.settings.save')}
          </Button>
        </div>
        <p className="ui-caption">
          {settings.nextScheduledAt ? t('adminBackups.settings.next', { value: dateTime.format(new Date(settings.nextScheduledAt)) }) : t('adminBackups.settings.nextNone')}
        </p>
        <p className="ui-caption">{t('adminBackups.settings.help')}</p>
      </div>
    </form>
  );
}

function RunsTable({ runs, bytes, dateTime }: { runs: BackupRunDTO[]; bytes: (n: number) => string; dateTime: Intl.DateTimeFormat }) {
  const t = useT();
  return (
    <section className="grid gap-2" aria-labelledby="backup-runs-title">
      <h3 id="backup-runs-title" className="ui-heading">
        {t('adminBackups.runs.title')}
      </h3>
      {runs.length === 0 ? (
        <p className="ui-text-muted">{t('adminBackups.runs.empty')}</p>
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <Thead>
              <Tr>
                {(['startedAt', 'trigger', 'status', 'size', 'detail'] as const).map((col) => (
                  <Th key={col}>{t(`adminBackups.runs.col.${col}`)}</Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {runs.map((r) => (
                <Tr key={r.id} className="align-top">
                  <Td className="whitespace-nowrap">{dateTime.format(new Date(r.startedAt))}</Td>
                  <Td>{t(`adminBackups.runs.trigger.${r.trigger}`)}</Td>
                  <Td className={r.status === 'FAILED' ? 'ui-text-error' : undefined}>{t(`adminBackups.runs.status.${r.status}`)}</Td>
                  <Td className="tabular-nums whitespace-nowrap">{r.sizeBytes === null ? '-' : bytes(r.sizeBytes)}</Td>
                  <Td className="ui-small ui-text-muted break-all">{r.error ?? r.objectKey ?? ''}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Card>
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
      <form onSubmit={submit} className="grid gap-3">
        <p className="ui-text-muted">{t('adminBackups.delete.warning')}</p>
        <p className="ui-mono break-all">{entry.name}</p>
        <Input aria-label={t('adminBackups.delete.confirmLabel')} value={typed} onChange={(e) => setTyped(e.target.value)} className="ui-mono" autoComplete="off" />
        <div className="flex justify-end gap-2">
          <Button variant="outline" tone="surface" onClick={onClose}>
            {t('adminBackups.delete.cancel')}
          </Button>
          <Button type="submit" tone="error" disabled={working || typed.trim() !== entry.name}>
            {t('adminBackups.delete.confirm')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
