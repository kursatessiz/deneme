'use client';

import { useState } from 'react';
import { PaymentMethod } from '@platform/shared';
import { bffFetch, BffError } from '@/lib/session/client';
import { hasAnyPermission } from '@/lib/nav';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';

interface PackageDefinitionRow {
  id: string;
  name: string;
  price: string | number;
}

const METHOD_LABEL: Record<string, string> = {
  CASH: 'Nakit',
  CREDIT_CARD_POS: 'Kredi kartı (POS)',
  BANK_TRANSFER: 'Havale/EFT',
};

const inputStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};

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
  const { permissions } = useDashboardSession();
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
      setError('Havale/EFT için referans giriniz');
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
          currency: 'TRY',
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
      setError(err instanceof BffError ? err.message : 'Paket satışı başarısız oldu');
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="space-y-3">
        <p className="text-sm" style={{ color: 'var(--color-text-primary)' }}>
          Paket satışı tamamlandı. Ödeme durumu:{' '}
          <strong>{result.paymentStatus === 'COMPLETED' ? 'Tamamlandı' : result.paymentStatus === 'PENDING' ? 'Beklemede' : result.paymentStatus}</strong>
        </p>
        {result.invoiceStatus && (
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            Fatura durumu: <strong>{result.invoiceStatus}</strong>
          </p>
        )}
        <div className="flex justify-end pt-2">
          <button
            onClick={onClose}
            className="text-xs font-medium px-4 py-1.5"
            style={{ borderRadius: 'var(--radius-button)', background: 'var(--gradient-brand)', color: 'var(--color-on-primary)' }}
          >
            Kapat
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label className="flex flex-col gap-1 text-xs">
        <span style={{ color: 'var(--color-text-secondary)' }}>Paket</span>
        <select
          className="px-2.5 py-1.5 text-sm"
          style={inputStyle}
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
              {p.name} - {Number(p.price).toLocaleString('tr-TR')} ₺
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs">
          <span style={{ color: 'var(--color-text-secondary)' }}>Ödeme yöntemi</span>
          <select className="px-2.5 py-1.5 text-sm" style={inputStyle} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
            {Object.entries(METHOD_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span style={{ color: 'var(--color-text-secondary)' }}>Tahsil edilen tutar</span>
          <input type="number" min={0} step="0.01" className="px-2.5 py-1.5 text-sm" style={inputStyle} value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} required />
        </label>
      </div>

      {paymentMethod === PaymentMethod.BANK_TRANSFER && (
        <label className="flex flex-col gap-1 text-xs">
          <span style={{ color: 'var(--color-text-secondary)' }}>Havale/EFT referansı</span>
          <input className="px-2.5 py-1.5 text-sm" style={inputStyle} value={bankReference} onChange={(e) => setBankReference(e.target.value)} required />
        </label>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs">
          <span style={{ color: 'var(--color-text-secondary)' }}>Promosyon kodu (opsiyonel)</span>
          <input className="px-2.5 py-1.5 text-sm" style={inputStyle} value={promoCode} onChange={(e) => setPromoCode(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span style={{ color: 'var(--color-text-secondary)' }}>Hediye kartı kodu (opsiyonel)</span>
          <input className="px-2.5 py-1.5 text-sm" style={inputStyle} value={giftCardCode} onChange={(e) => setGiftCardCode(e.target.value)} />
        </label>
      </div>

      {selectedDefinition && (
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Liste fiyatı: {Number(selectedDefinition.price).toLocaleString('tr-TR')} ₺
        </p>
      )}

      {error && (
        <p className="text-xs" style={{ color: '#b42318' }}>
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onClose}
          className="text-xs font-medium px-3 py-1.5"
          style={{ borderRadius: 'var(--radius-button)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
        >
          Vazgeç
        </button>
        <button
          type="submit"
          disabled={submitting || !packageDefinitionId}
          className="text-xs font-medium px-4 py-1.5 disabled:opacity-60"
          style={{ borderRadius: 'var(--radius-button)', background: 'var(--gradient-brand)', color: 'var(--color-on-primary)' }}
        >
          {submitting ? 'Satılıyor...' : 'Paketi sat'}
        </button>
      </div>
    </form>
  );
}
