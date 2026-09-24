'use client';

import { useEffect, useState } from 'react';
import { PaymentMethod, PaymentStatus } from '@platform/shared';
import type { PaymentDTO } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
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

const METHOD_LABEL: Record<string, string> = {
  CASH: 'Nakit',
  CREDIT_CARD_POS: 'Kredi kartı (POS)',
  BANK_TRANSFER: 'Havale/EFT',
  ONLINE_IYZICO: 'Online (iyzico)',
  ONLINE_PAYTR: 'Online (PayTR)',
};

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  COMPLETED: 'success',
  PENDING: 'warning',
  REFUNDED: 'neutral',
  FAILED: 'danger',
};
const STATUS_LABEL: Record<string, string> = {
  COMPLETED: 'Tamamlandı',
  PENDING: 'Bekliyor',
  REFUNDED: 'İade edildi',
  FAILED: 'Başarısız',
};

const selectStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};

function RefundDialog({ payment, studioId, onClose, onDone }: { payment: PaymentRow; studioId: string; onClose: () => void; onDone: () => void }) {
  const remaining = Number(payment.amount) - Number(payment.refundedAmount);
  const [amount, setAmount] = useState(String(remaining));
  const [reason, setReason] = useState('');
  const [full, setFull] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 3) {
      setError('İade nedeni giriniz (en az 3 karakter)');
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
      setError(err instanceof BffError ? err.message : 'İade işlemi başarısız oldu');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Ödemeyi iade et" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          İade edilebilir tutar: {formatMoney(String(remaining))}
        </p>
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-primary)' }}>
          <input type="radio" checked={full} onChange={() => setFull(true)} /> Tam iade
        </label>
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-primary)' }}>
          <input type="radio" checked={!full} onChange={() => setFull(false)} /> Kısmi iade
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
          placeholder="İade nedeni"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-full text-sm px-3 py-1.5"
          style={{ ...selectStyle, minHeight: 70 }}
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <PermissionButton type="button" variant="ghost" onClick={onClose}>
            Vazgeç
          </PermissionButton>
          <PermissionButton required={['finance.manage']} type="submit" variant="danger" disabled={submitting}>
            {submitting ? 'İade ediliyor...' : 'İade et'}
          </PermissionButton>
        </div>
      </form>
    </Modal>
  );
}

export function PaymentsTab() {
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
      .catch((err) => setError(err instanceof BffError ? err.message : 'Ödemeler yüklenemedi'))
      .finally(() => setLoading(false));
  }, [activeStudioId, branchId, method, status, from, to, reloadKey]);

  async function handleConfirmBankTransfer(paymentId: string) {
    if (!activeStudioId) return;
    setConfirmingId(paymentId);
    try {
      await bffFetch('payments/bank-transfer/confirm', { method: 'POST', studioId: activeStudioId, body: { paymentId } });
      setReloadKey((k) => k + 1);
    } catch (err) {
      window.alert(err instanceof BffError ? err.message : 'Havale onaylanamadı');
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
          onChange={({ from: f, to: t }) => {
            setFrom(f);
            setTo(t);
          }}
        />
        <BranchSelect value={branchId} onChange={setBranchId} />
        <select value={method} onChange={(e) => setMethod(e.target.value)} className="text-xs px-2.5 py-1.5" style={selectStyle}>
          <option value="">Tüm yöntemler</option>
          {Object.values(PaymentMethod).map((m) => (
            <option key={m} value={m}>
              {METHOD_LABEL[m] ?? m}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="text-xs px-2.5 py-1.5" style={selectStyle}>
          <option value="">Tüm durumlar</option>
          {Object.values(PaymentStatus).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s] ?? s}
            </option>
          ))}
        </select>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!payments || payments.length === 0) && (
        <EmptyState title="Ödeme bulunamadı" description="Seçili filtrelere uyan ödeme yok." />
      )}
      {!loading && !error && payments && payments.length > 0 && (
        <div className="border overflow-x-auto" style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-card)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--color-surface-muted)' }}>
                {['Tarih', 'Üye', 'Yöntem', 'Tutar', 'İade', 'Durum', ''].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 font-medium whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-t" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                  <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: 'var(--color-text-primary)' }}>
                    {new Date(p.paidAt).toLocaleString('tr-TR')}
                  </td>
                  <td className="px-4 py-2.5">
                    <a href={`/members/${p.memberId}`} className="hover:underline" style={{ color: 'var(--color-text-primary)' }}>
                      {p.memberId.slice(0, 8)}...
                    </a>
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--color-text-secondary)' }}>
                    {METHOD_LABEL[p.paymentMethod] ?? p.paymentMethod}
                  </td>
                  <td className="px-4 py-2.5 font-medium" style={{ color: 'var(--color-text-primary)' }}>
                    {formatMoney(p.amount)}
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--color-text-secondary)' }}>
                    {Number(p.refundedAmount) > 0 ? formatMoney(p.refundedAmount) : '-'}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={STATUS_TONE[p.paymentStatus] ?? 'neutral'}>{STATUS_LABEL[p.paymentStatus] ?? p.paymentStatus}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {p.paymentStatus === 'PENDING' && p.paymentMethod === 'BANK_TRANSFER' && (
                      <PermissionButton
                        required={['finance.manage']}
                        variant="primary"
                        onClick={() => handleConfirmBankTransfer(p.id)}
                        disabled={confirmingId === p.id}
                      >
                        {confirmingId === p.id ? 'Onaylanıyor...' : 'Havaleyi onayla'}
                      </PermissionButton>
                    )}
                    {p.paymentStatus === 'COMPLETED' && Number(p.refundedAmount) < Number(p.amount) && (
                      <PermissionButton required={['finance.manage']} variant="danger" onClick={() => setRefunding(p)}>
                        İade et
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
