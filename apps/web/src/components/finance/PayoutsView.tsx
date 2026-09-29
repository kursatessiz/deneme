'use client';

import { useEffect, useState } from 'react';
import {
  PAYOUT_EXPORT_FORMATS,
  PAYOUT_EXPORT_KINDS,
  PAYOUT_PROVIDERS,
  PAYOUT_RECONCILIATION_STATUSES,
  PAYOUT_STATUSES,
} from '@platform/shared';
import type {
  PayoutConnectionDTO,
  PayoutDetailDTO,
  PayoutExportFormat,
  PayoutExportKind,
  PayoutListDTO,
  PayoutSyncResultDTO,
} from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { bffFetch, BffError } from '@/lib/session/client';
import { formatMoney } from '@/lib/money';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { PermissionButton } from '@/components/common/PermissionButton';
import { Badge } from '@/components/common/Badge';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';
import { PayoutDetail } from '@/components/finance/PayoutDetail';
import { PAYOUT_STATUS_TONE, RECONCILIATION_TONE } from '@/components/finance/payout-tones';

const fieldStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-card)',
  backgroundColor: 'var(--color-surface)',
};

/** The picked end date is a calendar day: the range runs to the end of it. */
function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function ConnectionsPanel({ studioId, connections, onSaved }: { studioId: string; connections: PayoutConnectionDTO[]; onSaved: () => void }) {
  const t = useT();
  const locale = useLocale();
  const [accountDrafts, setAccountDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveAccount(provider: string) {
    setError(null);
    setMessage(null);
    const value = (accountDrafts[provider] ?? '').trim();
    try {
      await bffFetch(`studios/${studioId}/payouts/connections/${provider}`, { method: 'PATCH', studioId, body: { providerAccountId: value === '' ? null : value } });
      setMessage(t('payouts.connections.accountSaved'));
      onSaved();
    } catch (err) {
      setError(err instanceof BffError ? err.message : t('payouts.errors.accountFailed'));
    }
  }

  if (connections.length === 0) return null;
  return (
    <section className="p-4 space-y-3" style={cardStyle}>
      <h3 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>
        {t('payouts.connections.title')}
      </h3>
      <ul className="space-y-3">
        {connections.map((c) => (
          <li key={c.provider} className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span className="font-medium min-w-24" style={{ color: 'var(--color-text-primary)' }}>
              {t(`payouts.provider.${c.provider}`)}
            </span>
            {!c.supported && <Badge tone="neutral">{t('payouts.connections.unsupported')}</Badge>}
            {c.supported && (
              <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                {c.lastSyncedAt
                  ? t('payouts.connections.lastSynced', { date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(c.lastSyncedAt)) })
                  : t('payouts.connections.never')}
              </span>
            )}
            {c.lastError && <Badge tone="danger">{t(`payouts.connections.error.${c.lastError}`)}</Badge>}
            {c.supported && c.accountRequired && (
              <span className="inline-flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  aria-label={`${t('payouts.connections.accountLabel')} (${t(`payouts.provider.${c.provider}`)})`}
                  placeholder={t('payouts.connections.accountLabel')}
                  value={accountDrafts[c.provider] ?? c.providerAccountId ?? ''}
                  onChange={(e) => setAccountDrafts((d) => ({ ...d, [c.provider]: e.target.value }))}
                  className="text-xs px-2.5 py-1.5"
                  style={fieldStyle}
                />
                <PermissionButton required={['payouts.manage']} variant="secondary" onClick={() => saveAccount(c.provider)}>
                  {t('payouts.connections.accountSave')}
                </PermissionButton>
              </span>
            )}
          </li>
        ))}
      </ul>
      {message && (
        <p className="text-xs" role="status" style={{ color: 'var(--color-text-secondary)' }}>
          {message}
        </p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </section>
  );
}

function ExportCard({ studioId, from, to, provider }: { studioId: string; from: Date | null; to: Date | null; provider: string }) {
  const t = useT();
  const locale = useLocale();
  const [kind, setKind] = useState<PayoutExportKind>('payouts');
  const [format, setFormat] = useState<PayoutExportFormat>('xlsx');

  const params = new URLSearchParams({ kind, format, locale });
  if (from) params.set('from', from.toISOString());
  if (to) params.set('to', endOfDay(to).toISOString());
  if (provider) params.set('provider', provider);
  const href = `/api/bff/studios/${studioId}/payouts/export?${params.toString()}`;

  return (
    <section className="p-4 space-y-3" style={cardStyle}>
      <div>
        <h3 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {t('payouts.export.title')}
        </h3>
        <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          {t('payouts.export.description')}
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs space-y-1" style={{ color: 'var(--color-text-secondary)' }}>
          <span className="block">{t('payouts.export.kind')}</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as PayoutExportKind)} className="text-xs px-2.5 py-1.5" style={fieldStyle}>
            {PAYOUT_EXPORT_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`payouts.export.kind.${k}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs space-y-1" style={{ color: 'var(--color-text-secondary)' }}>
          <span className="block">{t('payouts.export.format')}</span>
          <select value={format} onChange={(e) => setFormat(e.target.value as PayoutExportFormat)} className="text-xs px-2.5 py-1.5" style={fieldStyle}>
            {PAYOUT_EXPORT_FORMATS.map((f) => (
              <option key={f} value={f}>
                {t(`payouts.export.format.${f}`)}
              </option>
            ))}
          </select>
        </label>
        <a
          href={href}
          download
          className="text-xs font-medium px-3 py-1.5 hover:opacity-90"
          style={{ borderRadius: 'var(--radius-button)', background: 'var(--gradient-brand)', color: 'var(--color-on-primary)' }}
        >
          {t('payouts.export.download')}
        </a>
      </div>
    </section>
  );
}

/**
 * Bank payouts (G5d-2, docs/BANKA_ODEMELERI.md): the list of provider
 * payouts with reconciliation chips, filters, "sync now", provider status,
 * export, and a detail view per payout. Everything goes through the BFF.
 */
export function PayoutsView() {
  const t = useT();
  const locale = useLocale();
  const { activeStudioId } = useDashboardSession();
  const [from, setFrom] = useState<Date | null>(null);
  const [to, setTo] = useState<Date | null>(null);
  const [provider, setProvider] = useState('');
  const [status, setStatus] = useState('');
  const [reconciliation, setReconciliation] = useState('');
  const [page, setPage] = useState(1);
  const [list, setList] = useState<PayoutListDTO | null>(null);
  const [connections, setConnections] = useState<PayoutConnectionDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncLines, setSyncLines] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PayoutDetailDTO | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeStudioId) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), pageSize: '25' });
    if (from) params.set('from', from.toISOString());
    if (to) params.set('to', endOfDay(to).toISOString());
    if (provider) params.set('provider', provider);
    if (status) params.set('status', status);
    if (reconciliation) params.set('reconciliationStatus', reconciliation);
    bffFetch<PayoutListDTO>(`studios/${activeStudioId}/payouts?${params.toString()}`, { studioId: activeStudioId })
      .then(setList)
      .catch((err) => setError(err instanceof BffError ? err.message : t('payouts.errors.loadFailed')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStudioId, from, to, provider, status, reconciliation, page, reloadKey]);

  useEffect(() => {
    if (!activeStudioId) return;
    bffFetch<{ items: PayoutConnectionDTO[] }>(`studios/${activeStudioId}/payouts/connections`, { studioId: activeStudioId })
      .then((res) => setConnections(res.items))
      .catch(() => setConnections([]));
  }, [activeStudioId, reloadKey]);

  useEffect(() => {
    if (!activeStudioId || !selectedId) {
      setDetail(null);
      return;
    }
    setDetailError(null);
    bffFetch<PayoutDetailDTO>(`studios/${activeStudioId}/payouts/${selectedId}`, { studioId: activeStudioId })
      .then(setDetail)
      .catch((err) => setDetailError(err instanceof BffError ? err.message : t('payouts.errors.detailFailed')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStudioId, selectedId]);

  async function syncNow() {
    if (!activeStudioId) return;
    setSyncing(true);
    setSyncLines([]);
    try {
      const res = await bffFetch<{ results: PayoutSyncResultDTO[] }>(`studios/${activeStudioId}/payouts/sync`, { method: 'POST', studioId: activeStudioId });
      const lines: string[] = [];
      const synced = res.results.filter((r) => r.outcome === 'SYNCED');
      if (res.results.length === 0) {
        lines.push(t('payouts.sync.nothing'));
      } else {
        if (synced.length > 0) {
          lines.push(
            t('payouts.sync.done', {
              payouts: synced.reduce((n, r) => n + r.payouts, 0),
              items: synced.reduce((n, r) => n + r.items, 0),
              matched: synced.reduce((n, r) => n + r.matched, 0),
            }),
          );
        }
        for (const r of res.results) {
          if (r.outcome !== 'SYNCED') lines.push(t(`payouts.sync.outcome.${r.outcome}`, { provider: t(`payouts.provider.${r.provider}`), payouts: r.payouts }));
        }
      }
      setSyncLines(lines);
      setPage(1);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setSyncLines([err instanceof BffError ? err.message : t('payouts.errors.syncFailed')]);
    } finally {
      setSyncing(false);
    }
  }

  const resetPage = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };
  const pages = list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1;
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });

  if (selectedId) {
    return (
      <div className="space-y-4">
        {detailError && <ErrorState message={detailError} />}
        {!detail && !detailError && <LoadingState />}
        {detail && (
          <PayoutDetail
            detail={detail}
            onChange={(next) => {
              setDetail(next);
              setReloadKey((k) => k + 1);
            }}
            onBack={() => setSelectedId(null)}
          />
        )}
        {detailError && (
          <PermissionButton variant="secondary" onClick={() => setSelectedId(null)}>
            {t('payouts.detail.back')}
          </PermissionButton>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <PermissionButton required={['payouts.manage']} variant="primary" disabled={syncing} onClick={syncNow}>
          {syncing ? t('payouts.sync.running') : t('payouts.sync.button')}
        </PermissionButton>
        {syncLines.length > 0 && (
          <div role="status" className="text-xs space-y-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            {syncLines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        )}
      </div>

      {activeStudioId && <ConnectionsPanel studioId={activeStudioId} connections={connections} onSaved={() => setReloadKey((k) => k + 1)} />}
      {activeStudioId && <ExportCard studioId={activeStudioId} from={from} to={to} provider={provider} />}

      <div className="flex flex-wrap items-end gap-2">
        <DateRangeFilter
          from={from}
          to={to}
          onChange={(range) => {
            setFrom(range.from);
            setTo(range.to);
            setPage(1);
          }}
        />
        <label className="text-xs space-y-1" style={{ color: 'var(--color-text-secondary)' }}>
          <span className="block">{t('payouts.filter.provider')}</span>
          <select value={provider} onChange={(e) => resetPage(setProvider)(e.target.value)} className="text-xs px-2.5 py-1.5" style={fieldStyle}>
            <option value="">{t('payouts.filter.allProviders')}</option>
            {PAYOUT_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {t(`payouts.provider.${p}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs space-y-1" style={{ color: 'var(--color-text-secondary)' }}>
          <span className="block">{t('payouts.filter.status')}</span>
          <select value={status} onChange={(e) => resetPage(setStatus)(e.target.value)} className="text-xs px-2.5 py-1.5" style={fieldStyle}>
            <option value="">{t('payouts.filter.allStatuses')}</option>
            {PAYOUT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`payouts.status.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs space-y-1" style={{ color: 'var(--color-text-secondary)' }}>
          <span className="block">{t('payouts.filter.reconciliation')}</span>
          <select value={reconciliation} onChange={(e) => resetPage(setReconciliation)(e.target.value)} className="text-xs px-2.5 py-1.5" style={fieldStyle}>
            <option value="">{t('payouts.filter.allReconciliation')}</option>
            {PAYOUT_RECONCILIATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`payouts.reconciliation.${s}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!list || list.items.length === 0) && <EmptyState title={t('payouts.empty.title')} description={t('payouts.empty.description')} />}
      {!loading && !error && list && list.items.length > 0 && (
        <>
          <div className="border overflow-x-auto" style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-card)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--color-surface-muted)' }}>
                  {[
                    t('payouts.col.arrivalDate'),
                    t('payouts.col.provider'),
                    t('payouts.col.providerPayoutId'),
                    t('payouts.col.status'),
                    t('payouts.col.gross'),
                    t('payouts.col.fee'),
                    t('payouts.col.refund'),
                    t('payouts.col.net'),
                    t('payouts.col.items'),
                    t('payouts.col.reconciliationStatus'),
                    '',
                  ].map((h, i) => (
                    <th key={i} className="text-left px-3 py-2.5 font-medium whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.items.map((p) => (
                  <tr key={p.id} className="border-t" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'var(--color-text-primary)' }}>
                      {day.format(new Date(p.arrivalDate))}
                    </td>
                    <td className="px-3 py-2.5" style={{ color: 'var(--color-text-secondary)' }}>
                      {t(`payouts.provider.${p.provider}`)}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs break-all" style={{ color: 'var(--color-text-secondary)' }}>
                      {p.providerPayoutId}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge tone={PAYOUT_STATUS_TONE[p.status]}>{t(`payouts.status.${p.status}`)}</Badge>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'var(--color-text-primary)' }}>
                      {formatMoney(p.grossAmount, p.currency, locale)}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                      {formatMoney(p.feeAmount, p.currency, locale)}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                      {formatMoney(p.refundAmount, p.currency, locale)}
                    </td>
                    <td className="px-3 py-2.5 font-medium whitespace-nowrap" style={{ color: 'var(--color-text-primary)' }}>
                      {formatMoney(p.netAmount, p.currency, locale)}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                      {t('payouts.table.items', { matched: p.matchedItemCount, total: p.matchableItemCount })}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge tone={RECONCILIATION_TONE[p.reconciliationStatus]}>{t(`payouts.reconciliation.${p.reconciliationStatus}`)}</Badge>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <PermissionButton variant="secondary" aria-label={`${t('payouts.table.open')} ${p.providerPayoutId}`} onClick={() => setSelectedId(p.id)}>
                        {t('payouts.table.open')}
                      </PermissionButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            <span>{t('payouts.table.total', { count: list.total })}</span>
            <span className="inline-flex items-center gap-2">
              <PermissionButton variant="secondary" disabled={page <= 1} onClick={() => setPage((n) => Math.max(1, n - 1))}>
                {t('payouts.pagination.prev')}
              </PermissionButton>
              <span>{t('payouts.pagination.page', { page, pages })}</span>
              <PermissionButton variant="secondary" disabled={page >= pages} onClick={() => setPage((n) => n + 1)}>
                {t('payouts.pagination.next')}
              </PermissionButton>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
