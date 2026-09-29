'use client';

import { useEffect, useState } from 'react';
import type { PayoutDetailDTO, PayoutItemDTO, PayoutPaymentCandidateDTO } from '@platform/shared';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { bffFetch, BffError } from '@/lib/session/client';
import { formatMoney } from '@/lib/money';
import { Badge } from '@/components/common/Badge';
import { Modal } from '@/components/common/Modal';
import { PermissionButton } from '@/components/common/PermissionButton';

/**
 * Manual match of one payout item to a payment (G5d-2): lists the payments
 * the API offers as candidates (same studio and currency, close in date,
 * exact amounts first) and links the chosen one. The API re-checks studio,
 * currency and the `payouts.manage` permission.
 */
export function PayoutMatchDialog({
  studioId,
  payoutId,
  item,
  onClose,
  onDone,
}: {
  studioId: string;
  payoutId: string;
  item: PayoutItemDTO;
  onClose: () => void;
  onDone: (detail: PayoutDetailDTO) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [candidates, setCandidates] = useState<PayoutPaymentCandidateDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  useEffect(() => {
    bffFetch<{ items: PayoutPaymentCandidateDTO[] }>(`studios/${studioId}/payouts/${payoutId}/items/${item.id}/candidates`, { studioId })
      .then((res) => setCandidates(res.items))
      .catch((err) => setError(err instanceof BffError ? err.message : t('payouts.errors.matchFailed')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioId, payoutId, item.id]);

  async function select(paymentId: string) {
    setSubmittingId(paymentId);
    setError(null);
    try {
      const detail = await bffFetch<PayoutDetailDTO>(`studios/${studioId}/payouts/${payoutId}/items/${item.id}/match`, {
        method: 'POST',
        studioId,
        body: { paymentId },
      });
      onDone(detail);
    } catch (err) {
      setError(err instanceof BffError ? err.message : t('payouts.errors.matchFailed'));
    } finally {
      setSubmittingId(null);
    }
  }

  return (
    <Modal title={t('payouts.match.title')} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          {t('payouts.match.description')}
        </p>
        <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
          {t(`payouts.itemType.${item.type}`)}: {formatMoney(item.amount, item.currency, locale)}
        </p>
        {error && <p className="text-xs text-red-600">{error}</p>}
        {!candidates && !error && (
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {t('payouts.match.loading')}
          </p>
        )}
        {candidates && candidates.length === 0 && (
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {t('payouts.match.empty')}
          </p>
        )}
        {candidates && candidates.length > 0 && (
          <ul className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
            {candidates.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2" style={{ borderColor: 'var(--color-border)' }}>
                <div className="min-w-0">
                  <p className="text-sm" style={{ color: 'var(--color-text-primary)' }}>
                    {c.receiptNumber ?? t('payouts.item.noReceipt')}
                    <span className="ml-2 font-medium">{formatMoney(c.amount, c.currency, locale)}</span>
                  </p>
                  <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(c.paidAt))}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {c.exactAmount && <Badge tone="success">{t('payouts.match.exact')}</Badge>}
                  <PermissionButton required={['payouts.manage']} variant="primary" disabled={submittingId !== null} onClick={() => select(c.id)}>
                    {t('payouts.match.select')}
                  </PermissionButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
