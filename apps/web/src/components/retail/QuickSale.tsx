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
import { fieldClass, fieldStyle, labelStyle, sectionStyle } from './styles';

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
      <section className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs space-y-1" style={labelStyle}>
            <span className="block">{t('retail.branch')}</span>
            <select value={activeBranch} onChange={(e) => setBranchId(e.target.value)} className="text-sm px-3 py-1.5" style={fieldStyle}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs space-y-1 flex-1 min-w-[220px]" style={labelStyle}>
            <span className="block">{t('retail.pos.searchLabel')}</span>
            <input
              type="search"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKey}
              placeholder={t('retail.pos.searchPlaceholder')}
              className={fieldClass}
              style={fieldStyle}
            />
          </label>
        </div>
        {searchMessage && (
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {searchMessage}
          </p>
        )}
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" data-testid="pos-results">
          {results.map((p) => {
            const stock = stockAt(p, activeBranch);
            return (
              <li key={p.id} className="p-3 flex items-center justify-between gap-2" style={sectionStyle}>
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>
                    {p.name}
                  </div>
                  <div className="text-xs" style={labelStyle}>
                    {formatMoney(p.price)}
                    {stock !== null && <span className="ml-2">{t('retail.pos.inStock', { count: stock })}</span>}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => addToCart(p)}
                  aria-label={`${t('retail.pos.add')} ${p.name}`}
                  className="text-xs font-medium px-3 py-1.5 shrink-0"
                  style={{ ...fieldStyle, borderRadius: 'var(--radius-button)' }}
                >
                  {t('retail.pos.add')}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <aside className="p-4 space-y-4 h-fit" style={sectionStyle} aria-label={t('retail.pos.cart')}>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {t('retail.pos.cart')}
        </h3>
        {done && (
          <div className="text-sm space-y-2" role="status">
            <p style={{ color: 'var(--color-text-primary)' }}>{t('retail.pos.done', { receipt: done.receiptNumber })}</p>
            <div className="flex gap-3 text-xs font-medium">
              <Link href={`/magaza/satislar/${done.id}`} className="hover:underline" style={{ color: 'var(--color-text-secondary)' }}>
                {t('retail.pos.viewReceipt')}
              </Link>
              <button type="button" onClick={() => setDone(null)} className="hover:underline" style={{ color: 'var(--color-text-secondary)' }}>
                {t('retail.pos.newSale')}
              </button>
            </div>
          </div>
        )}
        {cart.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {t('retail.pos.cartEmpty')}
          </p>
        ) : (
          <ul className="space-y-2" data-testid="pos-cart">
            {cart.map((l) => (
              <li key={l.product.id} className="text-sm space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>
                    {l.product.name}
                  </span>
                  <button type="button" aria-label={`${t('retail.pos.remove')} ${l.product.name}`} onClick={() => setQuantity(l.product.id, 0)} style={{ color: 'var(--color-text-muted)' }}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" aria-label={`${t('retail.pos.decrease')} ${l.product.name}`} onClick={() => setQuantity(l.product.id, l.quantity - 1)} className="p-1" style={fieldStyle}>
                    <Minus className="w-3 h-3" />
                  </button>
                  <span aria-label={t('retail.pos.quantity')} className="w-6 text-center">
                    {l.quantity}
                  </span>
                  <button type="button" aria-label={`${t('retail.pos.increase')} ${l.product.name}`} onClick={() => setQuantity(l.product.id, l.quantity + 1)} className="p-1" style={fieldStyle}>
                    <Plus className="w-3 h-3" />
                  </button>
                  <span className="text-xs" style={labelStyle}>
                    x {formatMoney(l.product.price)}
                  </span>
                  <input
                    inputMode="decimal"
                    aria-label={`${t('retail.pos.lineDiscount')} ${l.product.name}`}
                    placeholder={t('retail.pos.lineDiscount')}
                    value={l.discount}
                    onChange={(e) => setCart((lines) => lines.map((x) => (x.product.id === l.product.id ? { ...x, discount: e.target.value } : x)))}
                    className="ml-auto w-24 text-xs px-2 py-1"
                    style={fieldStyle}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}

        {canSearchMembers && (
          <div className="space-y-1">
            <span className="block text-xs" style={labelStyle}>
              {t('retail.pos.customer')}
            </span>
            {member ? (
              <div className="flex items-center justify-between text-sm" style={{ color: 'var(--color-text-primary)' }}>
                <span>{`${member.firstName ?? ''} ${member.lastName ?? ''}`.trim()}</span>
                <button type="button" onClick={() => setMember(null)} className="text-xs hover:underline" style={labelStyle}>
                  {t('retail.pos.clearCustomer')}
                </button>
              </div>
            ) : (
              <>
                <input
                  type="search"
                  aria-label={t('retail.pos.customerSearch')}
                  placeholder={t('retail.pos.customerSearch')}
                  value={memberQuery}
                  onChange={(e) => setMemberQuery(e.target.value)}
                  className={fieldClass}
                  style={fieldStyle}
                />
                {members.length > 0 && (
                  <ul className="text-sm" style={fieldStyle}>
                    {members.map((m) => (
                      <li key={m.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setMember(m);
                            setMembers([]);
                          }}
                          className="w-full text-left px-3 py-1.5 hover:opacity-80"
                        >
                          {`${m.firstName ?? ''} ${m.lastName ?? ''}`.trim()}
                          {m.phone && <span className="ml-2 text-xs" style={labelStyle}>{m.phone}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                  {t('retail.pos.walkIn')}
                </p>
              </>
            )}
          </div>
        )}

        {member && (
          <label className="block text-xs space-y-1" style={labelStyle}>
            <span>{t('retail.pos.promoCode')}</span>
            <input value={promoCode} onChange={(e) => setPromoCode(e.target.value.toUpperCase())} className={fieldClass} style={fieldStyle} />
          </label>
        )}

        <fieldset className="space-y-1">
          <legend className="text-xs" style={labelStyle}>
            {t('retail.pos.paymentMethod')}
          </legend>
          <div className="flex flex-wrap gap-3">
            {RETAIL_PAYMENT_METHODS.map((m) => (
              <label key={m} className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--color-text-primary)' }}>
                <input type="radio" name="retail-payment-method" checked={method === m} onChange={() => setMethod(m)} />
                {t(`retail.method.${m}`)}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="block text-xs space-y-1" style={labelStyle}>
          <span>{t('retail.pos.note')}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={fieldClass} style={fieldStyle} />
        </label>

        {estimate && (
          <dl className="text-sm space-y-1" data-testid="pos-totals">
            <div className="flex justify-between" style={labelStyle}>
              <dt>{t('retail.pos.subtotal')}</dt>
              <dd>{formatMoney(estimate.subtotal)}</dd>
            </div>
            {Number(estimate.discountTotal) > 0 && (
              <div className="flex justify-between" style={labelStyle}>
                <dt>{t('retail.pos.discount')}</dt>
                <dd>-{formatMoney(estimate.discountTotal)}</dd>
              </div>
            )}
            <div className="flex justify-between" style={labelStyle}>
              <dt>{t('retail.pos.tax')}</dt>
              <dd>{formatMoney(estimate.taxTotal)}</dd>
            </div>
            <div className="flex justify-between font-semibold text-base" style={{ color: 'var(--color-text-primary)' }}>
              <dt>{t('retail.pos.total')}</dt>
              <dd>{formatMoney(estimate.total)}</dd>
            </div>
            {promoCode.trim() && (
              <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                {t('retail.pos.estimateHint')}
              </p>
            )}
          </dl>
        )}

        {error && (
          <p className="text-xs" role="alert" style={{ color: 'var(--color-danger, #b42318)' }}>
            {error}
          </p>
        )}
        <PermissionButton required={['retail.sell']} variant="primary" className="w-full py-2 text-sm" disabled={busy || cart.length === 0} onClick={charge}>
          {busy ? t('retail.pos.charging') : t('retail.pos.charge')}
        </PermissionButton>
      </aside>
    </div>
  );
}
