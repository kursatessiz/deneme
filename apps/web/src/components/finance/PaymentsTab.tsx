'use client';

import { useEffect, useState } from 'react';
import { PaymentMethod, PaymentStatus } from '@platform/shared';
import type { PaymentDTO } from '@platform/shared';
import { useDashboardSession, useFormatMoney } from '@/components/session/DashboardSessionProvider';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { bffFetch, BffError } from '@/lib/session/client';
import { buildReportQuery } from '@/lib/reports/query';
import { formatMoney } from '@/lib/money';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { PermissionButton } from '@/components/common/PermissionButton';
import { Badge } from '@/components/common/Badge';
import { Modal } from '@/components/common/Modal';
import { BranchSelect } from '@/components/common/BranchSelect';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';

type PaymentRow = PaymentDTO;

const selectStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};

function RefundDialog({ payment, studioId, onClose, onDone }: { payment: PaymentRow; studioId: string; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const formatMoney = useFormatMoney();
  const remaining = Number(payment.amount) - Number(payment.refundedAmount);
  const [amount, setAmount] = useState(String(remaining));
  const [reason, setReason] = useState('');
  const [full, setFull] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 3) {
      setError(t('finance.refund.reasonRequired'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await bffFetch(`payments/${payment.id}/refund`, {
        method: 'POST',
        studioId,
        body: { amount: full ? undefined : Number(amount), reason: reason.trim() },
      });
      onDone();
    } catch (err) {
      setError(err instanceof BffError ? err.message : t('finance.refund.errors.failed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={t('finance.refund.title')} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          {t('finance.refund.remaining', { amount: formatMoney(String(remaining)) })}
        </p>
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-primary)' }}>
          <input type="radio" checked={full} onChange={() => setFull(true)} /> {t('finance.refund.full')}
        </label>
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-primary)' }}>
          <input type="radio" checked={!full} onChange={() => setFull(false)} /> {t('finance.refund.partial')}
        </label>
        {!full && (
          <input
            type="number"
            min="0.01"
            max={remaining}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full text-sm px-3 py-1.5"
            style={selectStyle}
          />
        )}
        <textarea
          placeholder={t('finance.refund.reasonPlaceholder')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-full text-sm px-3 py-1.5"
          style={{ ...selectStyle, minHeight: 70 }}
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <PermissionButton type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </PermissionButton>
          <PermissionButton required={['finance.manage']} type="submit" variant="danger" disabled={submitting}>
            {submitting ? t('finance.refund.submitting') : t('finance.refund.submit')}
          </PermissionButton>
        </div>
      </form>
    </Modal>
  );
}

export function PaymentsTab() {
  const t = useT();
  const formatMoney = useFormatMoney();
  const locale = useLocale();
  const { activeStudioId } = useDashboardSession();
  const [branchId, setBranchId] = useState('');
  const [method, setMethod] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState<Date | null>(null);
  const [to, setTo] = useState<Date | null>(null);
  const [payments, setPayments] = useState<PaymentRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refunding, setRefunding] = useState<PaymentRow | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const methodLabel = (m: string) => t(`finance.method.${m}`);
  const statusLabel = (s: string) => t(`finance.paymentStatus.${s}`);
  const statusTone: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
    COMPLETED: 'success',
    PENDING: 'warning',
    REFUNDED: 'neutral',
    FAILED: 'danger',
  };

  useEffect(() => {
    if (!activeStudioId) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams(buildReportQuery({ from, to, branchId: branchId || null }));
    if (method) params.set('paymentMethod', method);
    if (status) params.set('paymentStatus', status);
    const qs = params.toString();
    bffFetch<PaymentRow[]>(`payments${qs ? `?${qs}` : ''}`, { studioId: activeStudioId })
      .then(setPayments)
      .catch((err) => setError(err instanceof BffError ? err.message : t('finance.payments.errors.loadFailed')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStudioId, branchId, method, status, from, to, reloadKey]);

  async function handleConfirmBankTransfer(paymentId: string) {
    if (!activeStudioId) return;
    setConfirmingId(paymentId);
    try {
      await bffFetch('payments/bank-transfer/confirm', { method: 'POST', studioId: activeStudioId, body: { paymentId } });
      setReloadKey((k) => k + 1);
    } catch (err) {
      window.alert(err instanceof BffError ? err.message : t('finance.payments.errors.confirmFailed'));
    } finally {
      setConfirmingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <DateRangeFilter
          from={from}
          to={to}
          onChange={({ from: f, to: t2 }) => {
            setFrom(f);
            setTo(t2);
          }}
        />
        <BranchSelect value={branchId} onChange={setBranchId} />
        <select value={method} onChange={(e) => setMethod(e.target.value)} className="text-xs px-2.5 py-1.5" style={selectStyle}>
          <option value="">{t('finance.payments.allMethods')}</option>
          {Object.values(PaymentMethod).map((m) => (
            <option key={m} value={m}>
              {methodLabel(m)}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="text-xs px-2.5 py-1.5" style={selectStyle}>
          <option value="">{t('finance.payments.allStatuses')}</option>
          {Object.values(PaymentStatus).map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!payments || payments.length === 0) && (
        <EmptyState title={t('finance.payments.empty.title')} description={t('finance.payments.empty.description')} />
      )}
      {!loading && !error && payments && payments.length > 0 && (
        <div className="border overflow-x-auto" style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-card)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--color-surface-muted)' }}>
                {[
                  t('finance.payments.col.date'),
                  t('finance.payments.col.member'),
                  t('finance.payments.col.method'),
                  t('finance.payments.col.amount'),
                  t('finance.payments.col.refund'),
                  t('finance.payments.col.status'),
                  '',
                ].map((h, i) => (
                  <th key={i} className="text-left px-4 py-2.5 font-medium whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-t" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                  <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: 'var(--color-text-primary)' }}>
                    {new Date(p.paidAt).toLocaleString(locale)}
                  </td>
                  <td className="px-4 py-2.5">
                    {p.memberId ? (
                      <a href={`/members/${p.memberId}`} className="hover:underline" style={{ color: 'var(--color-text-primary)' }}>
                        {p.memberDisplayName ?? `${p.memberId.slice(0, 8)}...`}
                      </a>
                    ) : p.contactId ? (
                      <span className="inline-flex items-center gap-2">
                        <a href={`/kisiler/${p.contactId}`} className="hover:underline" style={{ color: 'var(--color-text-primary)' }}>
                          {p.contactDisplayName ?? `${p.contactId.slice(0, 8)}...`}
                        </a>
                        <Badge tone="neutral">{t('finance.payments.guest')}</Badge>
                      </span>
                    ) : (
                      <span style={{ color: 'var(--color-text-secondary)' }}>{t('finance.payments.walkIn')}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--color-text-secondary)' }}>
                    {methodLabel(p.paymentMethod)}
                  </td>
                  <td className="px-4 py-2.5 font-medium" style={{ color: 'var(--color-text-primary)' }}>
                    {formatMoney(p.amount)}
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--color-text-secondary)' }}>
                    {Number(p.refundedAmount) > 0 ? formatMoney(p.refundedAmount) : '-'}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={statusTone[p.paymentStatus] ?? 'neutral'}>{statusLabel(p.paymentStatus)}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {p.paymentStatus === 'PENDING' && p.paymentMethod === 'BANK_TRANSFER' && (
                      <PermissionButton
                        required={['finance.manage']}
                        variant="primary"
                        onClick={() => handleConfirmBankTransfer(p.id)}
                        disabled={confirmingId === p.id}
                      >
                        {confirmingId === p.id ? t('finance.payments.confirming') : t('finance.payments.confirmTransfer')}
                      </PermissionButton>
                    )}
                    {p.paymentStatus === 'COMPLETED' && Number(p.refundedAmount) < Number(p.amount) && (
                      <PermissionButton required={['finance.manage']} variant="danger" onClick={() => setRefunding(p)}>
                        {t('finance.payments.refundAction')}
                      </PermissionButton>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {refunding && activeStudioId && (
        <RefundDialog
          payment={refunding}
          studioId={activeStudioId}
          onClose={() => setRefunding(null)}
          onDone={() => {
            setRefunding(null);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}
