'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { SaleDTO } from '@platform/shared';
import { useFormatMoney, useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { bffFetch } from '@/lib/session/client';
import { useBff } from '@/lib/session/use-bff';
import { retailErrorMessage } from '@/lib/retail/errors';
import { LoadingState, ErrorState } from '@/components/common/DataState';
import { Forbidden } from '@/components/common/Forbidden';
import { PermissionButton } from '@/components/common/PermissionButton';
import { Badge } from '@/components/common/Badge';
import { Modal } from '@/components/common/Modal';
import { SALE_STATUS_TONE } from './SalesTab';
import { fieldClass, fieldStyle, labelStyle, sectionStyle } from './styles';

function RefundDialog({ sale, studioId, onClose, onDone }: { sale: SaleDTO; studioId: string; onClose: () => void; onDone: (next: SaleDTO) => void }) {
  const t = useT();
  const open = sale.lines.filter((l) => l.quantity > l.refundedQuantity);
  const [full, setFull] = useState(true);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 3) {
      setError(t('retail.refund.reasonRequired'));
      return;
    }
    const lines = open
      .map((l) => ({ saleLineId: l.id, quantity: quantities[l.id] ?? 0, restock: restock[l.id] ?? true }))
      .filter((l) => l.quantity > 0);
    if (!full && lines.length === 0) {
      setError(t('retail.refund.nothingSelected'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await bffFetch<SaleDTO>(`studios/${studioId}/retail/sales/${sale.id}/refund`, {
        method: 'POST',
        studioId,
        body: full ? { reason: reason.trim() } : { reason: reason.trim(), lines },
      });
      onDone(next);
    } catch (err) {
      setError(retailErrorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t('retail.refund.title')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-primary)' }}>
          <input type="radio" checked={full} onChange={() => setFull(true)} /> {t('retail.refund.full')}
        </label>
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-primary)' }}>
          <input type="radio" checked={!full} onChange={() => setFull(false)} /> {t('retail.refund.partial')}
        </label>
        {!full && (
          <ul className="space-y-2">
            {open.map((l) => {
              const max = l.quantity - l.refundedQuantity;
              return (
                <li key={l.id} className="text-sm space-y-1" style={{ color: 'var(--color-text-primary)' }}>
                  <div className="flex items-center justify-between gap-2">
                    <span>{l.productName}</span>
                    <span className="text-xs" style={labelStyle}>
                      {t('retail.refund.refundable', { count: max })}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      min={0}
                      max={max}
                      aria-label={`${t('retail.pos.quantity')} ${l.productName}`}
                      value={quantities[l.id] ?? 0}
                      onChange={(e) => setQuantities((q) => ({ ...q, [l.id]: Math.max(0, Math.min(max, Math.floor(Number(e.target.value) || 0))) }))}
                      className="w-20 text-sm px-2 py-1"
                      style={fieldStyle}
                    />
                    <label className="flex items-center gap-1.5 text-xs" style={labelStyle}>
                      <input type="checkbox" checked={restock[l.id] ?? true} onChange={(e) => setRestock((r) => ({ ...r, [l.id]: e.target.checked }))} />
                      {t('retail.refund.restock')}
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <label className="block text-xs space-y-1" style={labelStyle}>
          <span>{t('retail.refund.reason')}</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} className={fieldClass} style={fieldStyle} />
        </label>
        {error && (
          <p className="text-xs" style={{ color: 'var(--color-danger, #b42318)' }}>
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <PermissionButton type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </PermissionButton>
          <PermissionButton required={['retail.refund']} type="submit" variant="danger" disabled={busy}>
            {busy ? t('retail.refund.submitting') : t('retail.refund.submit')}
          </PermissionButton>
        </div>
      </form>
    </Modal>
  );
}

/**
 * One sale as a printable receipt. Printing uses CSS only: the global
 * print rule (globals.css) hides everything but the element marked
 * `data-print-receipt`, so the browser's own print dialog produces a clean
 * receipt without any extra library.
 */
export function SaleReceipt({ saleId }: { saleId: string }) {
  const t = useT();
  const locale = useLocale();
  const formatMoney = useFormatMoney();
  const { activeStudioId } = useDashboardSession();
  const [reloadKey, setReloadKey] = useState(0);
  const { data, loading, error, forbidden } = useBff<SaleDTO>(`studios/${activeStudioId}/retail/sales/${saleId}`, activeStudioId, reloadKey);
  const [sale, setSale] = useState<SaleDTO | null>(null);
  const [refunding, setRefunding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const current = sale ?? data;

  async function voidSale() {
    if (!current) return;
    const reason = window.prompt(`${t('retail.refund.voidConfirm')} ${t('retail.refund.reason')}`);
    if (!reason || reason.trim().length < 3) return;
    try {
      const next = await bffFetch<SaleDTO>(`studios/${activeStudioId}/retail/sales/${current.id}/void`, {
        method: 'POST',
        studioId: activeStudioId,
        body: { reason: reason.trim() },
      });
      setSale(next);
      setMessage(t('retail.refund.voidDone'));
    } catch (err) {
      setMessage(retailErrorMessage(t, err));
    }
  }

  if (forbidden) return <Forbidden />;
  if (loading && !current) return <LoadingState />;
  if (error || !current) return <ErrorState message={error ?? undefined} />;

  const refundable = current.status === 'COMPLETED' || current.status === 'PARTIALLY_REFUNDED';
  const money = (v: string) => formatMoney(v);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/magaza" className="text-sm font-medium hover:underline" style={labelStyle}>
          {t('retail.receipt.back')}
        </Link>
        <div className="flex flex-wrap gap-2">
          <PermissionButton variant="secondary" onClick={() => window.print()}>
            {t('retail.receipt.print')}
          </PermissionButton>
          {refundable && (
            <PermissionButton required={['retail.refund']} variant="danger" onClick={() => setRefunding(true)}>
              {t('retail.refund.open')}
            </PermissionButton>
          )}
          {current.status === 'COMPLETED' && (
            <PermissionButton required={['retail.refund']} variant="danger" onClick={voidSale}>
              {t('retail.refund.void')}
            </PermissionButton>
          )}
        </div>
      </div>
      {message && (
        <p className="text-xs" role="status" style={labelStyle}>
          {message}
        </p>
      )}

      <article data-print-receipt className="p-6 max-w-md mx-auto space-y-4" style={sectionStyle} aria-label={t('retail.receipt.title')}>
        <header className="space-y-1 text-center">
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {t('retail.receipt.title')}
          </h2>
          <p className="text-xs" style={labelStyle}>
            {t('retail.receipt.number', { receipt: current.receiptNumber })}
          </p>
          <p className="text-xs" style={labelStyle}>
            {t('retail.receipt.date', { date: new Date(current.createdAt).toLocaleString(locale) })}
          </p>
          <p className="text-xs" style={labelStyle}>
            {t('retail.receipt.branch', { branch: current.branchName })}
          </p>
          {current.customerName && (
            <p className="text-xs" style={labelStyle}>
              {t('retail.receipt.customer', { name: current.customerName })}
            </p>
          )}
          <div>
            <Badge tone={SALE_STATUS_TONE[current.status]}>{t(`retail.status.${current.status}`)}</Badge>
          </div>
        </header>

        <table className="w-full text-sm">
          <thead>
            <tr style={labelStyle}>
              <th className="text-left font-medium py-1">{t('retail.receipt.col.item')}</th>
              <th className="text-right font-medium py-1">{t('retail.receipt.col.qty')}</th>
              <th className="text-right font-medium py-1">{t('retail.receipt.col.total')}</th>
            </tr>
          </thead>
          <tbody>
            {current.lines.map((l) => (
              <tr key={l.id} className="align-top" style={{ color: 'var(--color-text-primary)' }}>
                <td className="py-1">
                  <div>{l.productName}</div>
                  <div className="text-[11px]" style={labelStyle}>
                    {money(l.unitPrice)}
                    {Number(l.lineDiscount) > 0 && <span className="ml-2">{t('retail.receipt.lineDiscount', { amount: money(l.lineDiscount) })}</span>}
                  </div>
                </td>
                <td className="py-1 text-right">{l.quantity}</td>
                <td className="py-1 text-right whitespace-nowrap">{money(l.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="text-sm space-y-1 border-t pt-2" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex justify-between" style={labelStyle}>
            <dt>{t('retail.receipt.subtotal')}</dt>
            <dd>{money(current.subtotal)}</dd>
          </div>
          {Number(current.discountTotal) > 0 && (
            <div className="flex justify-between" style={labelStyle}>
              <dt>{current.promoCode ? t('retail.receipt.promo', { code: current.promoCode }) : t('retail.receipt.discount')}</dt>
              <dd>-{money(current.discountTotal)}</dd>
            </div>
          )}
          <div className="flex justify-between" style={labelStyle}>
            <dt>{t('retail.receipt.net')}</dt>
            <dd>{money(current.netTotal)}</dd>
          </div>
          <div className="flex justify-between" style={labelStyle}>
            <dt>{t('retail.receipt.tax')}</dt>
            <dd>{money(current.taxTotal)}</dd>
          </div>
          <div className="flex justify-between font-semibold text-base" style={{ color: 'var(--color-text-primary)' }}>
            <dt>{t('retail.receipt.total')}</dt>
            <dd>{money(current.total)}</dd>
          </div>
          {Number(current.refundedAmount) > 0 && (
            <div className="flex justify-between" style={labelStyle}>
              <dt>{t('retail.receipt.refunded')}</dt>
              <dd>-{money(current.refundedAmount)}</dd>
            </div>
          )}
        </dl>
        <footer className="text-xs space-y-0.5 text-center" style={labelStyle}>
          <p>{t('retail.receipt.paidWith', { method: t(`retail.method.${current.paymentMethod}`) })}</p>
          {current.pricesIncludeTax && <p>{t('retail.receipt.taxIncluded')}</p>}
          {current.soldByName && <p>{t('retail.receipt.soldBy', { name: current.soldByName })}</p>}
        </footer>
        {current.refunds.length > 0 && (
          <section className="text-xs space-y-1 border-t pt-2" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
            <h3 className="font-semibold">{t('retail.receipt.refunds')}</h3>
            <ul>
              {current.refunds.map((r) => (
                <li key={r.id}>{t('retail.receipt.refundLine', { date: new Date(r.createdAt).toLocaleString(locale), amount: money(r.amount), reason: r.reason })}</li>
              ))}
            </ul>
          </section>
        )}
      </article>

      {refunding && (
        <RefundDialog
          sale={current}
          studioId={activeStudioId}
          onClose={() => setRefunding(false)}
          onDone={(next) => {
            setRefunding(false);
            setSale(next);
            setMessage(t('retail.refund.done'));
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}
