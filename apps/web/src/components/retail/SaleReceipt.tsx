'use client';

import { useState } from 'react';
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
import { Card, CardContent, Checkbox, FieldGroup, Input, LinkButton, Radio, Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui';

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
      <form onSubmit={submit} className="grid gap-3">
        <Radio checked={full} onChange={() => setFull(true)} label={t('retail.refund.full')} />
        <Radio checked={!full} onChange={() => setFull(false)} label={t('retail.refund.partial')} />
        {!full && (
          <ul className="grid gap-3">
            {open.map((l) => {
              const max = l.quantity - l.refundedQuantity;
              return (
                <li key={l.id} className="grid gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span>{l.productName}</span>
                    <span className="ui-caption">{t('retail.refund.refundable', { count: max })}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Input
                      type="number"
                      min={0}
                      max={max}
                      aria-label={`${t('retail.pos.quantity')} ${l.productName}`}
                      value={quantities[l.id] ?? 0}
                      onChange={(e) => setQuantities((q) => ({ ...q, [l.id]: Math.max(0, Math.min(max, Math.floor(Number(e.target.value) || 0))) }))}
                      className="w-20"
                    />
                    <Checkbox checked={restock[l.id] ?? true} onChange={(e) => setRestock((r) => ({ ...r, [l.id]: e.target.checked }))} label={t('retail.refund.restock')} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <FieldGroup label={t('retail.refund.reason')}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </FieldGroup>
        {error && <p className="ui-caption ui-text-error">{error}</p>}
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
        <LinkButton href="/magaza" variant="link" tone="surface" size="sm">
          {t('retail.receipt.back')}
        </LinkButton>
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
        <p className="ui-caption" role="status">
          {message}
        </p>
      )}

      <Card as="article" data-print-receipt className="max-w-md mx-auto" aria-label={t('retail.receipt.title')}>
        <CardContent>
          <header className="grid gap-1 text-center">
            <h2 className="ui-heading">{t('retail.receipt.title')}</h2>
            <p className="ui-caption">{t('retail.receipt.number', { receipt: current.receiptNumber })}</p>
            <p className="ui-caption">{t('retail.receipt.date', { date: new Date(current.createdAt).toLocaleString(locale) })}</p>
            <p className="ui-caption">{t('retail.receipt.branch', { branch: current.branchName })}</p>
            {current.customerName && <p className="ui-caption">{t('retail.receipt.customer', { name: current.customerName })}</p>}
            <div>
              <Badge tone={SALE_STATUS_TONE[current.status]}>{t(`retail.status.${current.status}`)}</Badge>
            </div>
          </header>

          <Table>
            <Thead>
              <Tr>
                <Th className="text-left">{t('retail.receipt.col.item')}</Th>
                <Th className="text-right">{t('retail.receipt.col.qty')}</Th>
                <Th className="text-right">{t('retail.receipt.col.total')}</Th>
              </Tr>
            </Thead>
            <Tbody>
              {current.lines.map((l) => (
                <Tr key={l.id} className="align-top">
                  <Td>
                    <div>{l.productName}</div>
                    <div className="ui-caption">
                      {money(l.unitPrice)}
                      {Number(l.lineDiscount) > 0 && <span className="ml-2">{t('retail.receipt.lineDiscount', { amount: money(l.lineDiscount) })}</span>}
                    </div>
                  </Td>
                  <Td className="text-right">{l.quantity}</Td>
                  <Td className="text-right whitespace-nowrap">{money(l.total)}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>

          <dl className="grid gap-1 ui-rule pt-2">
            <div className="flex justify-between ui-text-muted">
              <dt>{t('retail.receipt.subtotal')}</dt>
              <dd>{money(current.subtotal)}</dd>
            </div>
            {Number(current.discountTotal) > 0 && (
              <div className="flex justify-between ui-text-muted">
                <dt>{current.promoCode ? t('retail.receipt.promo', { code: current.promoCode }) : t('retail.receipt.discount')}</dt>
                <dd>-{money(current.discountTotal)}</dd>
              </div>
            )}
            <div className="flex justify-between ui-text-muted">
              <dt>{t('retail.receipt.net')}</dt>
              <dd>{money(current.netTotal)}</dd>
            </div>
            <div className="flex justify-between ui-text-muted">
              <dt>{t('retail.receipt.tax')}</dt>
              <dd>{money(current.taxTotal)}</dd>
            </div>
            <div className="flex justify-between ui-strong">
              <dt>{t('retail.receipt.total')}</dt>
              <dd>{money(current.total)}</dd>
            </div>
            {Number(current.refundedAmount) > 0 && (
              <div className="flex justify-between ui-text-muted">
                <dt>{t('retail.receipt.refunded')}</dt>
                <dd>-{money(current.refundedAmount)}</dd>
              </div>
            )}
          </dl>
          <footer className="grid gap-0.5 text-center ui-caption">
            <p>{t('retail.receipt.paidWith', { method: t(`retail.method.${current.paymentMethod}`) })}</p>
            {current.pricesIncludeTax && <p>{t('retail.receipt.taxIncluded')}</p>}
            {current.soldByName && <p>{t('retail.receipt.soldBy', { name: current.soldByName })}</p>}
          </footer>
          {current.refunds.length > 0 && (
            <section className="grid gap-1 ui-rule pt-2 ui-small">
              <h3 className="ui-strong">{t('retail.receipt.refunds')}</h3>
              <ul>
                {current.refunds.map((r) => (
                  <li key={r.id}>{t('retail.receipt.refundLine', { date: new Date(r.createdAt).toLocaleString(locale), amount: money(r.amount), reason: r.reason })}</li>
                ))}
              </ul>
            </section>
          )}
        </CardContent>
      </Card>

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
