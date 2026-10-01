'use client';

import { useState } from 'react';
import { PaymentMethod } from '@platform/shared';
import { bffFetch, BffError } from '@/lib/session/client';
import { hasAnyPermission } from '@/lib/nav';
import { useDashboardSession, useFormatMoney } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { FieldGroup } from '@/components/ui/FieldGroup';
import { Button } from '@/components/ui/Button';

interface PackageDefinitionRow {
  id: string;
  name: string;
  price: string | number;
}

const METHODS: PaymentMethod[] = [PaymentMethod.CASH, PaymentMethod.CREDIT_CARD_POS, PaymentMethod.BANK_TRANSFER];

export function PackageSaleDialog({
  studioId,
  memberId,
  packageDefinitions,
  onClose,
  onSold,
}: {
  studioId: string;
  memberId: string;
  packageDefinitions: PackageDefinitionRow[];
  onClose: () => void;
  onSold: () => void;
}) {
  const t = useT();
  const { permissions, currency } = useDashboardSession();
  const formatMoney = useFormatMoney();
  const methodLabel = (m: PaymentMethod) => t(`finance.method.${m}`);
  const canViewInvoices = hasAnyPermission(['finance.view'], permissions, false);
  const [packageDefinitionId, setPackageDefinitionId] = useState(packageDefinitions[0]?.id ?? '');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [paidAmount, setPaidAmount] = useState(() => String(packageDefinitions[0]?.price ?? ''));
  const [bankReference, setBankReference] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [giftCardCode, setGiftCardCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ paymentStatus: string; invoiceStatus: string | null } | null>(null);

  const selectedDefinition = packageDefinitions.find((p) => p.id === packageDefinitionId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (paymentMethod === PaymentMethod.BANK_TRANSFER && !bankReference.trim()) {
      setError(t('members.sale.bankReferenceRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const sale = await bffFetch<{ payment: { id: string; paymentStatus: string } }>('payments/sell', {
        method: 'POST',
        studioId,
        body: {
          studioId,
          memberId,
          packageDefinitionId,
          paymentMethod,
          paidAmount: Number(paidAmount),
          currency,
          bankReference: paymentMethod === PaymentMethod.BANK_TRANSFER ? bankReference : undefined,
          promoCode: promoCode || undefined,
          giftCardCode: giftCardCode || undefined,
        },
      });

      let invoiceStatus: string | null = null;
      if (canViewInvoices && sale.payment.paymentStatus === 'COMPLETED') {
        try {
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          const invoices = await bffFetch<{ id: string; status: string; paymentId: string }[]>(
            `invoices?from=${encodeURIComponent(todayStart.toISOString())}`,
            { studioId },
          );
          invoiceStatus = invoices.find((inv) => inv.paymentId === sale.payment.id)?.status ?? null;
        } catch {
          /* invoice lookup is best-effort; the sale itself already succeeded */
        }
      }

      setResult({ paymentStatus: sale.payment.paymentStatus, invoiceStatus });
      onSold();
    } catch (err) {
      setError(err instanceof BffError ? err.message : t('members.sale.errors.sellFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="grid gap-3">
        <p>
          {t('members.sale.complete')}{' '}
          <strong>
            {result.paymentStatus === 'COMPLETED'
              ? t('members.sale.paymentStatus.COMPLETED')
              : result.paymentStatus === 'PENDING'
                ? t('members.sale.paymentStatus.PENDING')
                : result.paymentStatus}
          </strong>
        </p>
        {result.invoiceStatus && (
          <p className="ui-text-muted">
            {t('members.sale.invoiceStatus')} <strong>{result.invoiceStatus}</strong>
          </p>
        )}
        <div className="flex justify-end pt-2">
          <Button onClick={onClose}>{t('members.sale.close')}</Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-3">
      <FieldGroup label={t('members.sale.package')}>
        <Select
          value={packageDefinitionId}
          onChange={(e) => {
            setPackageDefinitionId(e.target.value);
            const def = packageDefinitions.find((p) => p.id === e.target.value);
            if (def) setPaidAmount(String(def.price));
          }}
          required
        >
          {packageDefinitions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} - {formatMoney(p.price)}
            </option>
          ))}
        </Select>
      </FieldGroup>

      <div className="grid grid-cols-2 gap-3">
        <FieldGroup label={t('members.sale.paymentMethod')}>
          <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {methodLabel(m)}
              </option>
            ))}
          </Select>
        </FieldGroup>
        <FieldGroup label={t('members.sale.collectedAmount')}>
          <Input type="number" min={0} step="0.01" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} required />
        </FieldGroup>
      </div>

      {paymentMethod === PaymentMethod.BANK_TRANSFER && (
        <FieldGroup label={t('members.sale.bankReference')}>
          <Input value={bankReference} onChange={(e) => setBankReference(e.target.value)} required />
        </FieldGroup>
      )}

      <div className="grid grid-cols-2 gap-3">
        <FieldGroup label={t('members.sale.promoCode')}>
          <Input value={promoCode} onChange={(e) => setPromoCode(e.target.value)} />
        </FieldGroup>
        <FieldGroup label={t('members.sale.giftCardCode')}>
          <Input value={giftCardCode} onChange={(e) => setGiftCardCode(e.target.value)} />
        </FieldGroup>
      </div>

      {selectedDefinition && <p className="ui-caption">{t('members.sale.listPrice', { price: formatMoney(selectedDefinition.price) })}</p>}

      {error && <p className="ui-caption ui-text-error">{error}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" tone="surface" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={submitting || !packageDefinitionId}>
          {submitting ? t('members.sale.selling') : t('members.sale.sell')}
        </Button>
      </div>
    </form>
  );
}
