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
import { Input } from '@/components/ui/Input';
import { Radio } from '@/components/ui/Radio';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui/Table';
import { Card } from '@/components/ui/Card';
import { useToast } from '@/components/ui';

type PaymentRow = PaymentDTO;

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
      <form onSubmit={handleSubmit} className="grid gap-3">
        <p className="ui-caption">{t('finance.refund.remaining', { amount: formatMoney(String(remaining)) })}</p>
        <Radio label={t('finance.refund.full')} checked={full} onChange={() => setFull(true)} />
        <Radio label={t('finance.refund.partial')} checked={!full} onChange={() => setFull(false)} />
        {!full && <Input type="number" min="0.01" max={remaining} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full" />}
        <Textarea placeholder={t('finance.refund.reasonPlaceholder')} value={reason} onChange={(e) => setReason(e.target.value)} className="w-full" />
        {error && <p className="ui-caption ui-text-error">{error}</p>}
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
  const toast = useToast();
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
      toast.error(err instanceof BffError ? err.message : t('finance.payments.errors.confirmFailed'));
    } finally {
      setConfirmingId(null);
    }
  }

  return (
    <div className="grid gap-4">
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
        <Select value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="">{t('finance.payments.allMethods')}</option>
          {Object.values(PaymentMethod).map((m) => (
            <option key={m} value={m}>
              {methodLabel(m)}
            </option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('finance.payments.allStatuses')}</option>
          {Object.values(PaymentStatus).map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </Select>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!payments || payments.length === 0) && (
        <EmptyState title={t('finance.payments.empty.title')} description={t('finance.payments.empty.description')} />
      )}
      {!loading && !error && payments && payments.length > 0 && (
        <Card className="overflow-x-auto">
          <Table>
            <Thead>
              <Tr>
                {[
                  t('finance.payments.col.date'),
                  t('finance.payments.col.member'),
                  t('finance.payments.col.method'),
                  t('finance.payments.col.amount'),
                  t('finance.payments.col.refund'),
                  t('finance.payments.col.status'),
                  '',
                ].map((h, i) => (
                  <Th key={i} className="whitespace-nowrap">
                    {h}
                  </Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {payments.map((p) => (
                <Tr key={p.id}>
                  <Td className="whitespace-nowrap">{new Date(p.paidAt).toLocaleString(locale)}</Td>
                  <Td>
                    {p.memberId ? (
                      <a href={`/members/${p.memberId}`} className="pui-link pui-surface">
                        {p.memberDisplayName ?? `${p.memberId.slice(0, 8)}...`}
                      </a>
                    ) : p.contactId ? (
                      <span className="inline-flex items-center gap-2">
                        <a href={`/kisiler/${p.contactId}`} className="pui-link pui-surface">
                          {p.contactDisplayName ?? `${p.contactId.slice(0, 8)}...`}
                        </a>
                        <Badge tone="neutral">{t('finance.payments.guest')}</Badge>
                      </span>
                    ) : (
                      <span className="ui-text-muted">{t('finance.payments.walkIn')}</span>
                    )}
                  </Td>
                  <Td>{methodLabel(p.paymentMethod)}</Td>
                  <Td className="ui-strong">{formatMoney(p.amount)}</Td>
                  <Td>{Number(p.refundedAmount) > 0 ? formatMoney(p.refundedAmount) : '-'}</Td>
                  <Td>
                    <Badge tone={statusTone[p.paymentStatus] ?? 'neutral'}>{statusLabel(p.paymentStatus)}</Badge>
                  </Td>
                  <Td className="text-right whitespace-nowrap">
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
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Card>
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
