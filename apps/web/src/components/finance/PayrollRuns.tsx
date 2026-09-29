'use client';

import { useEffect, useState } from 'react';
import type { PayrollLineDTO, PayrollRunDTO, PayrollRunStatus } from '@platform/shared';
import { useDashboardSession, useFormatMoney } from '@/components/session/DashboardSessionProvider';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { bffFetch, BffError } from '@/lib/session/client';
import { formatMoney } from '@/lib/money';
import { toDateInputValue, fromDateInputValue } from '@/lib/date-range';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { PermissionButton } from '@/components/common/PermissionButton';
import { Badge } from '@/components/common/Badge';
import { Modal } from '@/components/common/Modal';
import { BranchSelect } from '@/components/common/BranchSelect';

type RunStatus = PayrollRunStatus;
type PayrollLineDetail = PayrollLineDTO;
type PayrollRun = PayrollRunDTO;

const STATUS_TONE: Record<RunStatus, 'neutral' | 'warning' | 'success'> = { DRAFT: 'neutral', APPROVED: 'warning', PAID: 'success' };

const inputStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};

function NewRunDialog({ studioId, onClose, onDone }: { studioId: string; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [periodStart, setPeriodStart] = useState(() => toDateInputValue(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [periodEnd, setPeriodEnd] = useState(() => toDateInputValue(new Date()));
  const [branchId, setBranchId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const start = fromDateInputValue(periodStart);
    const end = fromDateInputValue(periodEnd);
    if (!start || !end || start >= end) {
      setError(t('finance.payroll.periodInvalid'));
      return;
    }
    setSubmitting(true);
    try {
      await bffFetch('payroll/runs', {
        method: 'POST',
        studioId,
        body: { periodStart: start.toISOString(), periodEnd: end.toISOString(), branchId: branchId || undefined },
      });
      onDone();
    } catch (err) {
      setError(err instanceof BffError ? err.message : t('finance.payroll.errors.createFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={t('finance.payroll.newRunTitle')} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex items-center gap-2">
          <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="flex-1 text-sm px-3 py-1.5" style={inputStyle} />
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            -
          </span>
          <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="flex-1 text-sm px-3 py-1.5" style={inputStyle} />
        </div>
        <BranchSelect value={branchId} onChange={setBranchId} className="w-full" />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <PermissionButton type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </PermissionButton>
          <PermissionButton required={['payroll.manage']} type="submit" variant="primary" disabled={submitting}>
            {submitting ? t('finance.payroll.creating') : t('finance.payroll.createSubmit')}
          </PermissionButton>
        </div>
      </form>
    </Modal>
  );
}

function AdjustLineDialog({
  studioId,
  runId,
  line,
  onClose,
  onDone,
}: {
  studioId: string;
  runId: string;
  line: PayrollLineDetail;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const [amount, setAmount] = useState('0');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (note.trim().length < 3) {
      setError(t('finance.payroll.adjustReasonRequired'));
      return;
    }
    setSubmitting(true);
    try {
      await bffFetch(`payroll/runs/${runId}/lines/${line.id}/adjust`, {
        method: 'PATCH',
        studioId,
        body: { amount: Number(amount), note: note.trim() },
      });
      onDone();
    } catch (err) {
      setError(err instanceof BffError ? err.message : t('finance.payroll.errors.adjustFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={t('finance.payroll.adjustTitle', { name: line.trainerFullName })} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          {t('finance.payroll.adjustHint')}
        </p>
        <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full text-sm px-3 py-1.5" style={inputStyle} />
        <textarea
          placeholder={t('finance.payroll.notePlaceholder')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full text-sm px-3 py-1.5"
          style={{ ...inputStyle, minHeight: 60 }}
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <PermissionButton type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </PermissionButton>
          <PermissionButton required={['payroll.manage']} type="submit" variant="primary" disabled={submitting}>
            {submitting ? t('finance.payroll.adjustSaving') : t('finance.payroll.adjustSubmit')}
          </PermissionButton>
        </div>
      </form>
    </Modal>
  );
}

function RunDetail({ studioId, run, onReload }: { studioId: string; run: PayrollRun; onReload: () => void }) {
  const t = useT();
  const formatMoney = useFormatMoney();
  const locale = useLocale();
  const [adjustingLine, setAdjustingLine] = useState<PayrollLineDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const statusLabel = (s: RunStatus) => t(`finance.runStatus.${s}`);

  async function handleApprove() {
    setBusy(true);
    try {
      await bffFetch(`payroll/runs/${run.id}/approve`, { method: 'POST', studioId });
      onReload();
    } catch (err) {
      window.alert(err instanceof BffError ? err.message : t('finance.payroll.errors.approveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function handleMarkPaid() {
    setBusy(true);
    try {
      await bffFetch(`payroll/runs/${run.id}/mark-paid`, { method: 'POST', studioId });
      onReload();
    } catch (err) {
      window.alert(err instanceof BffError ? err.message : t('finance.payroll.errors.markPaidFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge tone={STATUS_TONE[run.status]}>{statusLabel(run.status)}</Badge>
          <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {new Date(run.periodStart).toLocaleDateString(locale)} - {new Date(run.periodEnd).toLocaleDateString(locale)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/api/bff/payroll/studio/${studioId}/runs/${run.id}/export.csv`}
            className="text-xs font-medium px-3 py-1.5"
            style={{ ...inputStyle, background: 'var(--color-surface-muted)' }}
          >
            {t('finance.payroll.downloadCsv')}
          </a>
          {run.status === 'DRAFT' && (
            <PermissionButton required={['payroll.manage']} variant="primary" onClick={handleApprove} disabled={busy}>
              {t('finance.payroll.approve')}
            </PermissionButton>
          )}
          {run.status === 'APPROVED' && (
            <PermissionButton required={['payroll.manage']} variant="primary" onClick={handleMarkPaid} disabled={busy}>
              {t('finance.payroll.markPaid')}
            </PermissionButton>
          )}
        </div>
      </div>

      <div className="border overflow-x-auto" style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-card)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ backgroundColor: 'var(--color-surface-muted)' }}>
              {[
                t('finance.payroll.col.trainer'),
                t('finance.payroll.col.sessions'),
                t('finance.payroll.col.attendees'),
                t('finance.payroll.col.gross'),
                t('finance.payroll.col.adjustment'),
                t('finance.payroll.col.net'),
                '',
              ].map((h, i) => (
                <th key={i} className="text-left px-4 py-2.5 font-medium whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(run.lines ?? []).map((l) => (
              <tr key={l.id} className="border-t" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                <td className="px-4 py-2.5" style={{ color: 'var(--color-text-primary)' }}>
                  {l.trainerFullName}
                </td>
                <td className="px-4 py-2.5" style={{ color: 'var(--color-text-secondary)' }}>
                  {l.sessions}
                </td>
                <td className="px-4 py-2.5" style={{ color: 'var(--color-text-secondary)' }}>
                  {l.attendees}
                </td>
                <td className="px-4 py-2.5" style={{ color: 'var(--color-text-secondary)' }}>
                  {formatMoney(l.grossAmount)}
                </td>
                <td className="px-4 py-2.5" style={{ color: 'var(--color-text-secondary)' }}>
                  {formatMoney(l.adjustments)}
                  {l.note && (
                    <span className="block text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                      {l.note}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  {formatMoney(l.netAmount)}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {run.status === 'DRAFT' && (
                    <PermissionButton required={['payroll.manage']} onClick={() => setAdjustingLine(l)}>
                      {t('finance.payroll.adjust')}
                    </PermissionButton>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ backgroundColor: 'var(--color-surface-muted)' }}>
              <td colSpan={5} className="px-4 py-2.5 font-semibold text-right" style={{ color: 'var(--color-text-primary)' }}>
                {t('finance.payroll.totalNet')}
              </td>
              <td colSpan={2} className="px-4 py-2.5 font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                {formatMoney(run.totalNet)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {adjustingLine && (
        <AdjustLineDialog
          studioId={studioId}
          runId={run.id}
          line={adjustingLine}
          onClose={() => setAdjustingLine(null)}
          onDone={() => {
            setAdjustingLine(null);
            onReload();
          }}
        />
      )}
    </div>
  );
}

export function PayrollRuns() {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const locale = useLocale();
  const [runs, setRuns] = useState<PayrollRun[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<PayrollRun | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const statusLabel = (s: RunStatus) => t(`finance.runStatus.${s}`);

  useEffect(() => {
    if (!activeStudioId) return;
    setLoading(true);
    setError(null);
    bffFetch<PayrollRun[]>(`payroll/studio/${activeStudioId}/runs`, { studioId: activeStudioId })
      .then((data) => {
        setRuns(data);
        if (!selectedRunId && data.length > 0) setSelectedRunId(data[0].id);
      })
      .catch((err) => setError(err instanceof BffError ? err.message : t('finance.payroll.errors.loadFailed')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStudioId, reloadKey]);

  useEffect(() => {
    if (!activeStudioId || !selectedRunId) {
      setSelectedRun(null);
      return;
    }
    bffFetch<PayrollRun>(`payroll/studio/${activeStudioId}/runs/${selectedRunId}`, { studioId: activeStudioId })
      .then(setSelectedRun)
      .catch(() => setSelectedRun(null));
  }, [activeStudioId, selectedRunId, reloadKey]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
            {t('finance.payroll.title')}
          </h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            {t('finance.payroll.subtitle')}
          </p>
        </div>
        <PermissionButton required={['payroll.manage']} variant="primary" onClick={() => setShowNew(true)}>
          {t('finance.payroll.newPeriod')}
        </PermissionButton>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!runs || runs.length === 0) && (
        <EmptyState title={t('finance.payroll.empty.title')} description={t('finance.payroll.empty.description')} />
      )}

      {!loading && !error && runs && runs.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {runs.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelectedRunId(r.id)}
              className="text-xs font-medium px-3 py-1.5"
              style={{
                borderRadius: 'var(--radius-button)',
                border: '1px solid var(--color-border)',
                background: r.id === selectedRunId ? 'var(--gradient-brand)' : 'var(--color-surface)',
                color: r.id === selectedRunId ? 'var(--color-on-primary)' : 'var(--color-text-primary)',
              }}
            >
              {new Date(r.periodStart).toLocaleDateString(locale)} - {new Date(r.periodEnd).toLocaleDateString(locale)} ({statusLabel(r.status)})
            </button>
          ))}
        </div>
      )}

      {selectedRun && activeStudioId && <RunDetail studioId={activeStudioId} run={selectedRun} onReload={() => setReloadKey((k) => k + 1)} />}

      {showNew && activeStudioId && (
        <NewRunDialog
          studioId={activeStudioId}
          onClose={() => setShowNew(false)}
          onDone={() => {
            setShowNew(false);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}
