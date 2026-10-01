'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Minus, Plus, X } from 'lucide-react';
import { RETAIL_PAYMENT_METHODS, computeCartTotals } from '@platform/shared';
import type { BranchDTO, MemberDetailDTO, ProductDTO, RetailPaymentMethod, RetailSettingsDTO, SaleDTO } from '@platform/shared';
import { useDashboardSession, useFormatMoney } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { bffFetch } from '@/lib/session/client';
import { useBff } from '@/lib/session/use-bff';
import { hasAnyPermission } from '@/lib/nav';
import { newCheckoutKey, retailErrorMessage } from '@/lib/retail/errors';
import { PermissionButton } from '@/components/common/PermissionButton';
import { Button, FieldGroup, Input, List, ListItem, Radio, Select } from '@/components/ui';

interface CartLine {
  product: ProductDTO;
  quantity: number;
  discount: string;
}

const MONEY_RE = /^\d{1,10}(\.\d{1,2})?$/;

function stockAt(product: ProductDTO, branchId: string): number | null {
  if (!product.trackStock) return null;
  return product.stock.find((s) => s.branchId === branchId)?.quantity ?? 0;
}

/**
 * The desk's point of sale: search or scan a product (a scanner types the
 * barcode and presses Enter), build the cart, optionally pick a member (for
 * a payment record, promo code and loyalty points), choose how the customer
 * pays and take the payment. Totals shown here are an estimate with the
 * shared cart math; the API computes the authoritative ones.
 */
export function QuickSale() {
  const t = useT();
  const formatMoney = useFormatMoney();
  const { activeStudioId, permissions, isOwner } = useDashboardSession();
  const canSearchMembers = hasAnyPermission(['members.view'], permissions, isOwner);
  const { data: branchData } = useBff<BranchDTO[]>(`branches/studio/${activeStudioId}`, activeStudioId);
  const { data: settings } = useBff<RetailSettingsDTO>(`studios/${activeStudioId}/retail/settings`, activeStudioId);
  const branches = useMemo(() => (branchData ?? []).filter((b) => b.isActive), [branchData]);
  const [branchId, setBranchId] = useState('');
  const activeBranch = branchId || branches[0]?.id || '';

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProductDTO[]>([]);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [memberQuery, setMemberQuery] = useState('');
  const [members, setMembers] = useState<MemberDetailDTO[]>([]);
  const [member, setMember] = useState<MemberDetailDTO | null>(null);
  const [promoCode, setPromoCode] = useState('');
  const [method, setMethod] = useState<RetailPaymentMethod>('CASH');
  const [note, setNote] = useState('');
  const [checkoutKey, setCheckoutKey] = useState(newCheckoutKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<SaleDTO | null>(null);

  // Product search, refreshed as the staff types (and when the branch changes, for stock).
  useEffect(() => {
    if (!activeStudioId || !activeBranch) return;
    const q = query.trim();
    const handle = setTimeout(() => {
      const params = new URLSearchParams({ active: 'true', branchId: activeBranch });
      if (q) params.set('search', q);
      bffFetch<{ items: ProductDTO[] }>(`studios/${activeStudioId}/retail/products?${params.toString()}`, { studioId: activeStudioId })
        .then((res) => {
          setResults(res.items.slice(0, 30));
          setSearchMessage(res.items.length === 0 ? t('retail.pos.noResults') : null);
        })
        .catch((err) => setSearchMessage(retailErrorMessage(t, err, 'retail.loadFailed')));
    }, 200);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStudioId, activeBranch, query]);

  useEffect(() => {
    if (!canSearchMembers || memberQuery.trim().length < 2) {
      setMembers([]);
      return;
    }
    const handle = setTimeout(() => {
      bffFetch<MemberDetailDTO[]>(`members/studio/${activeStudioId}?search=${encodeURIComponent(memberQuery.trim())}`, { studioId: activeStudioId })
        .then((rows) => setMembers(rows.slice(0, 8)))
        .catch(() => setMembers([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [activeStudioId, canSearchMembers, memberQuery]);

  function addToCart(product: ProductDTO) {
    setDone(null);
    setError(null);
    setCart((lines) => {
      const existing = lines.find((l) => l.product.id === product.id);
      if (existing) return lines.map((l) => (l.product.id === product.id ? { ...l, quantity: l.quantity + 1 } : l));
      return [...lines, { product, quantity: 1, discount: '' }];
    });
  }

  async function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = query.trim();
    if (!code) return;
    try {
      const params = new URLSearchParams({ active: 'true', branchId: activeBranch, barcode: code });
      const res = await bffFetch<{ items: ProductDTO[] }>(`studios/${activeStudioId}/retail/products?${params.toString()}`, { studioId: activeStudioId });
      const match = res.items[0] ?? (results.length === 1 ? results[0] : null);
      if (match) {
        addToCart(match);
        setQuery('');
      } else {
        setSearchMessage(t('retail.pos.notFoundBarcode'));
      }
    } catch (err) {
      setSearchMessage(retailErrorMessage(t, err));
    }
  }

  const setQuantity = (productId: string, quantity: number) =>
    setCart((lines) => (quantity <= 0 ? lines.filter((l) => l.product.id !== productId) : lines.map((l) => (l.product.id === productId ? { ...l, quantity } : l))));

  const estimate = useMemo(() => {
    if (!settings || cart.length === 0) return null;
    try {
      return computeCartTotals({
        currency: settings.currency,
        pricesIncludeTax: settings.pricesIncludeTax,
        lines: cart.map((l) => ({
          unitPrice: l.product.price,
          quantity: l.quantity,
          discount: MONEY_RE.test(l.discount.replace(',', '.')) ? l.discount.replace(',', '.') : undefined,
          taxRate: l.product.effectiveTaxRate,
        })),
      });
    } catch {
      return null;
    }
  }, [cart, settings]);

  async function charge() {
    if (cart.length === 0 || !activeBranch) return;
    if (promoCode.trim() && !member) {
      setError(t('retail.pos.promoNeedsMember'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const sale = await bffFetch<SaleDTO>(`studios/${activeStudioId}/retail/sales`, {
        method: 'POST',
        studioId: activeStudioId,
        body: {
          branchId: activeBranch,
          memberId: member?.id,
          lines: cart.map((l) => {
            const discount = l.discount.trim().replace(',', '.');
            return { productId: l.product.id, quantity: l.quantity, ...(MONEY_RE.test(discount) && Number(discount) > 0 ? { discount } : {}) };
          }),
          paymentMethod: method,
          promoCode: promoCode.trim() || undefined,
          note: note.trim() || undefined,
          idempotencyKey: checkoutKey,
        },
      });
      setDone(sale);
      setCart([]);
      setMember(null);
      setMemberQuery('');
      setPromoCode('');
      setNote('');
      setCheckoutKey(newCheckoutKey());
      setQuery('');
    } catch (err) {
      setError(retailErrorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <section className="grid gap-3 content-start">
        <div className="flex flex-wrap items-end gap-3">
          <FieldGroup label={t('retail.branch')}>
            <Select value={activeBranch} onChange={(e) => setBranchId(e.target.value)}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </FieldGroup>
          <FieldGroup label={t('retail.pos.searchLabel')} className="flex-1 min-w-[220px]">
            <Input type="search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKey} placeholder={t('retail.pos.searchPlaceholder')} />
          </FieldGroup>
        </div>
        {searchMessage && <p className="ui-caption">{searchMessage}</p>}
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" data-testid="pos-results">
          {results.map((p) => {
            const stock = stockAt(p, activeBranch);
            return (
              <li key={p.id} className="pui-card">
                <div className="pui-card-content flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="ui-strong truncate">{p.name}</div>
                    <div className="ui-caption">
                      {formatMoney(p.price)}
                      {stock !== null && <span className="ml-2">{t('retail.pos.inStock', { count: stock })}</span>}
                    </div>
                  </div>
                  <Button variant="outline" tone="surface" size="sm" onClick={() => addToCart(p)} aria-label={`${t('retail.pos.add')} ${p.name}`} className="shrink-0">
                    {t('retail.pos.add')}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <aside className="pui-card h-fit" aria-label={t('retail.pos.cart')}>
        <div className="pui-card-content">
          <h3 className="ui-heading">{t('retail.pos.cart')}</h3>
          {done && (
            <div className="grid gap-2" role="status">
              <p>{t('retail.pos.done', { receipt: done.receiptNumber })}</p>
              <div className="flex gap-3 ui-small">
                <Link href={`/magaza/satislar/${done.id}`} className="pui-link pui-surface">
                  {t('retail.pos.viewReceipt')}
                </Link>
                <Button variant="link" tone="surface" size="sm" onClick={() => setDone(null)}>
                  {t('retail.pos.newSale')}
                </Button>
              </div>
            </div>
          )}
          {cart.length === 0 ? (
            <p className="ui-caption">{t('retail.pos.cartEmpty')}</p>
          ) : (
            <ul className="grid gap-3" data-testid="pos-cart">
              {cart.map((l) => (
                <li key={l.product.id} className="grid gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="ui-strong truncate">{l.product.name}</span>
                    <Button variant="link" tone="muted" size="sm" iconOnly aria-label={`${t('retail.pos.remove')} ${l.product.name}`} onClick={() => setQuantity(l.product.id, 0)} icon={<X className="ui-icon" aria-hidden="true" />} />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" tone="surface" size="sm" iconOnly aria-label={`${t('retail.pos.decrease')} ${l.product.name}`} onClick={() => setQuantity(l.product.id, l.quantity - 1)} icon={<Minus className="ui-icon" aria-hidden="true" />} />
                    <span aria-label={t('retail.pos.quantity')} className="w-6 text-center">
                      {l.quantity}
                    </span>
                    <Button variant="outline" tone="surface" size="sm" iconOnly aria-label={`${t('retail.pos.increase')} ${l.product.name}`} onClick={() => setQuantity(l.product.id, l.quantity + 1)} icon={<Plus className="ui-icon" aria-hidden="true" />} />
                    <span className="ui-caption">x {formatMoney(l.product.price)}</span>
                    <Input
                      inputMode="decimal"
                      aria-label={`${t('retail.pos.lineDiscount')} ${l.product.name}`}
                      placeholder={t('retail.pos.lineDiscount')}
                      value={l.discount}
                      onChange={(e) => setCart((lines) => lines.map((x) => (x.product.id === l.product.id ? { ...x, discount: e.target.value } : x)))}
                      className="ml-auto w-24"
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}

          {canSearchMembers && (
            <div className="grid gap-1">
              <span className="ui-caption">{t('retail.pos.customer')}</span>
              {member ? (
                <div className="flex items-center justify-between">
                  <span>{`${member.firstName ?? ''} ${member.lastName ?? ''}`.trim()}</span>
                  <Button variant="link" tone="muted" size="sm" onClick={() => setMember(null)}>
                    {t('retail.pos.clearCustomer')}
                  </Button>
                </div>
              ) : (
                <>
                  <Input type="search" aria-label={t('retail.pos.customerSearch')} placeholder={t('retail.pos.customerSearch')} value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} />
                  {members.length > 0 && (
                    <List className="ui-panel">
                      {members.map((m) => (
                        <ListItem key={m.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setMember(m);
                              setMembers([]);
                            }}
                            className="w-full text-left"
                          >
                            {`${m.firstName ?? ''} ${m.lastName ?? ''}`.trim()}
                            {m.phone && <span className="ml-2 ui-caption">{m.phone}</span>}
                          </button>
                        </ListItem>
                      ))}
                    </List>
                  )}
                  <p className="ui-caption">{t('retail.pos.walkIn')}</p>
                </>
              )}
            </div>
          )}

          {member && (
            <FieldGroup label={t('retail.pos.promoCode')}>
              <Input value={promoCode} onChange={(e) => setPromoCode(e.target.value.toUpperCase())} />
            </FieldGroup>
          )}

          <fieldset className="grid gap-1">
            <legend className="ui-caption">{t('retail.pos.paymentMethod')}</legend>
            <div className="flex flex-wrap gap-3">
              {RETAIL_PAYMENT_METHODS.map((m) => (
                <Radio key={m} name="retail-payment-method" checked={method === m} onChange={() => setMethod(m)} label={t(`retail.method.${m}`)} />
              ))}
            </div>
          </fieldset>

          <FieldGroup label={t('retail.pos.note')}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </FieldGroup>

          {estimate && (
            <dl className="grid gap-1" data-testid="pos-totals">
              <div className="flex justify-between ui-text-muted">
                <dt>{t('retail.pos.subtotal')}</dt>
                <dd>{formatMoney(estimate.subtotal)}</dd>
              </div>
              {Number(estimate.discountTotal) > 0 && (
                <div className="flex justify-between ui-text-muted">
                  <dt>{t('retail.pos.discount')}</dt>
                  <dd>-{formatMoney(estimate.discountTotal)}</dd>
                </div>
              )}
              <div className="flex justify-between ui-text-muted">
                <dt>{t('retail.pos.tax')}</dt>
                <dd>{formatMoney(estimate.taxTotal)}</dd>
              </div>
              <div className="flex justify-between ui-strong ui-rule pt-2">
                <dt>{t('retail.pos.total')}</dt>
                <dd>{formatMoney(estimate.total)}</dd>
              </div>
              {promoCode.trim() && <p className="ui-caption">{t('retail.pos.estimateHint')}</p>}
            </dl>
          )}

          {error && (
            <p className="ui-small ui-text-error" role="alert">
              {error}
            </p>
          )}
          <PermissionButton required={['retail.sell']} variant="primary" className="ui-btn-block" disabled={busy || cart.length === 0} onClick={charge}>
            {busy ? t('retail.pos.charging') : t('retail.pos.charge')}
          </PermissionButton>
        </div>
      </aside>
    </div>
  );
}
