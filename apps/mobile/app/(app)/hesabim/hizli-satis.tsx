import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { RETAIL_PAYMENT_METHODS, computeCartTotals } from '@platform/shared';
import type { BranchDTO, ProductDTO, RetailPaymentMethod, RetailSettingsDTO, SaleDTO } from '@platform/shared';

import { ChoiceRow } from '../../../src/components/ChoiceRow';
import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { TextField } from '../../../src/components/TextField';
import { formatCurrency, useLocale, useT } from '../../../src/i18n';
import { ApiError, apiRequest } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { palette, spacing, typography, useTheme, useThemeFonts } from '../../../src/theme';

const KNOWN_ERRORS = ['RETAIL_INSUFFICIENT_STOCK', 'RETAIL_PRODUCT_INACTIVE', 'RETAIL_PRODUCT_NOT_FOUND', 'RETAIL_BRANCH_NOT_FOUND'];

interface CartLine {
  product: ProductDTO;
  quantity: number;
}

/** A fresh idempotency key per checkout attempt: a retried request never sells twice. */
function newKey(): string {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Staff quick sale (G3c-2): search products, build a cart and take a cash or
 * card-terminal payment for a walk-in customer. Selling to a member (payment
 * record, promo code, loyalty points) stays on the web quick sale screen.
 */
export default function HizliSatisScreen() {
  const t = useT();
  const { locale } = useLocale();
  const { activeMembership } = useSession();
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const c = theme.colors;
  const studioId = activeMembership?.studioId;

  const [branches, setBranches] = useState<BranchDTO[]>([]);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [settings, setSettings] = useState<RetailSettingsDTO | null>(null);
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState<ProductDTO[] | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [method, setMethod] = useState<RetailPaymentMethod>('CASH');
  const [key, setKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const money = useCallback((amount: string) => formatCurrency(Number(amount), locale, settings?.currency ?? activeMembership?.currency ?? 'USD'), [locale, settings, activeMembership]);

  useEffect(() => {
    if (!studioId) return;
    Promise.all([
      apiRequest<BranchDTO[]>(`/branches/studio/${studioId}`, { studioId }),
      apiRequest<RetailSettingsDTO>(`/studios/${studioId}/retail/settings`, { studioId }),
    ])
      .then(([b, s]) => {
        const active = b.filter((x) => x.isActive);
        setBranches(active);
        setBranchId((current) => current ?? active[0]?.id ?? null);
        setSettings(s);
      })
      .catch(() => setMessage({ text: t('mRetail.loadFailed'), error: true }));
  }, [studioId, t]);

  useEffect(() => {
    if (!studioId || !branchId) return;
    const handle = setTimeout(() => {
      const params = new URLSearchParams({ active: 'true', branchId });
      if (query.trim()) params.set('search', query.trim());
      apiRequest<{ items: ProductDTO[] }>(`/studios/${studioId}/retail/products?${params.toString()}`, { studioId })
        .then((res) => setProducts(res.items.slice(0, 30)))
        .catch(() => setMessage({ text: t('mRetail.loadFailed'), error: true }));
    }, 250);
    return () => clearTimeout(handle);
  }, [studioId, branchId, query, t]);

  const add = (product: ProductDTO) => {
    setMessage(null);
    setCart((lines) =>
      lines.some((l) => l.product.id === product.id)
        ? lines.map((l) => (l.product.id === product.id ? { ...l, quantity: l.quantity + 1 } : l))
        : [...lines, { product, quantity: 1 }],
    );
  };
  const setQuantity = (productId: string, quantity: number) =>
    setCart((lines) => (quantity <= 0 ? lines.filter((l) => l.product.id !== productId) : lines.map((l) => (l.product.id === productId ? { ...l, quantity } : l))));

  const totals = useMemo(() => {
    if (!settings || cart.length === 0) return null;
    return computeCartTotals({
      currency: settings.currency,
      pricesIncludeTax: settings.pricesIncludeTax,
      lines: cart.map((l) => ({ unitPrice: l.product.price, quantity: l.quantity, taxRate: l.product.effectiveTaxRate })),
    });
  }, [cart, settings]);

  const charge = async () => {
    if (!studioId || !branchId || cart.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const sale = await apiRequest<SaleDTO>(`/studios/${studioId}/retail/sales`, {
        method: 'POST',
        studioId,
        body: { branchId, lines: cart.map((l) => ({ productId: l.product.id, quantity: l.quantity })), paymentMethod: method, idempotencyKey: key },
      });
      setCart([]);
      setKey(newKey());
      setMessage({ text: t('mRetail.done', { receipt: sale.receiptNumber }), error: false });
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined;
      setMessage({ text: code && KNOWN_ERRORS.includes(code) ? t(`mRetail.error.${code}`) : t('mRetail.failed'), error: true });
    } finally {
      setBusy(false);
    }
  };

  const card = { backgroundColor: c.surface, borderColor: c.border, borderRadius: theme.family.radii.card };

  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={[styles.note, fonts.body, { color: c.textMuted }]}>{t('mRetail.walkInNote')}</Text>

      {branches.length > 1 ? (
        <View style={[styles.card, card, theme.family.cardBorder && styles.bordered]}>
          <Text style={[styles.title, fonts.display, { color: c.textPrimary }]}>{t('mRetail.branch')}</Text>
          {branches.map((b) => (
            <ChoiceRow key={b.id} label={b.name} selected={b.id === branchId} onPress={() => setBranchId(b.id)} />
          ))}
        </View>
      ) : null}

      <TextField label={t('mRetail.search')} value={query} onChangeText={setQuery} placeholder={t('mRetail.search')} />
      {!products ? <ActivityIndicator /> : null}
      {products && products.length === 0 ? <Text style={[styles.note, fonts.body, { color: c.textMuted }]}>{t('mRetail.noResults')}</Text> : null}
      {products?.map((p) => {
        const stock = p.trackStock ? (p.stock.find((s) => s.branchId === branchId)?.quantity ?? 0) : null;
        return (
          <View key={p.id} style={[styles.row, card, theme.family.cardBorder && styles.bordered]}>
            <View style={styles.rowText}>
              <Text style={[fonts.bodyStrong, { color: c.textPrimary }]}>{p.name}</Text>
              <Text style={[styles.meta, fonts.body, { color: c.textMuted }]}>
                {money(p.price)} - {stock === null ? t('mRetail.untracked') : t('mRetail.stock', { count: stock })}
              </Text>
            </View>
            <PrimaryButton label={t('mRetail.add')} variant="secondary" onPress={() => add(p)} />
          </View>
        );
      })}

      <View style={[styles.card, card, theme.family.cardBorder && styles.bordered]}>
        <Text style={[styles.title, fonts.display, { color: c.textPrimary }]}>{t('mRetail.cart')}</Text>
        {cart.length === 0 ? <Text style={[styles.note, fonts.body, { color: c.textMuted }]}>{t('mRetail.cartEmpty')}</Text> : null}
        {cart.map((l) => (
          <View key={l.product.id} style={[styles.cartRow, { borderColor: c.border }]}>
            <View style={styles.rowText}>
              <Text style={[fonts.body, { color: c.textPrimary }]}>{l.product.name}</Text>
              <Text style={[styles.meta, fonts.body, { color: c.textMuted }]}>{t('mRetail.lineQuantity', { count: l.quantity, price: money(l.product.price) })}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`${t('mRetail.decrease')} ${l.product.name}`} onPress={() => setQuantity(l.product.id, l.quantity - 1)} style={[styles.step, { borderColor: c.border, borderRadius: theme.family.radii.button }]}>
              <Text style={[fonts.bodyStrong, { color: c.textPrimary }]}>-</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`${t('mRetail.increase')} ${l.product.name}`} onPress={() => setQuantity(l.product.id, l.quantity + 1)} style={[styles.step, { borderColor: c.border, borderRadius: theme.family.radii.button }]}>
              <Text style={[fonts.bodyStrong, { color: c.textPrimary }]}>+</Text>
            </Pressable>
          </View>
        ))}
        {totals ? (
          <View style={styles.totals}>
            <Text style={[fonts.body, { color: c.textSecondary }]}>{`${t('mRetail.subtotal')}: ${money(totals.subtotal)}`}</Text>
            <Text style={[fonts.body, { color: c.textSecondary }]}>{`${t('mRetail.tax')}: ${money(totals.taxTotal)}`}</Text>
            <Text style={[styles.total, fonts.display, { color: c.textPrimary }]}>{`${t('mRetail.total')}: ${money(totals.total)}`}</Text>
          </View>
        ) : null}
      </View>

      <View style={[styles.card, card, theme.family.cardBorder && styles.bordered]}>
        <Text style={[styles.title, fonts.display, { color: c.textPrimary }]}>{t('mRetail.paymentMethod')}</Text>
        {RETAIL_PAYMENT_METHODS.map((m) => (
          <ChoiceRow key={m} label={t(`mRetail.method.${m}`)} selected={method === m} onPress={() => setMethod(m)} />
        ))}
      </View>

      {message ? <Text style={[styles.note, fonts.body, { color: message.error ? palette.danger : c.textPrimary }]}>{message.text}</Text> : null}
      <PrimaryButton label={busy ? t('mRetail.charging') : t('mRetail.charge')} onPress={charge} disabled={cart.length === 0 || !branchId} loading={busy} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing[4], gap: spacing[3] },
  card: { padding: spacing[4], gap: spacing[2] },
  bordered: { borderWidth: 1 },
  title: { fontSize: typography.size.lg, marginBottom: spacing[1] },
  note: { fontSize: typography.size.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], padding: spacing[3] },
  rowText: { flex: 1, gap: 2 },
  meta: { fontSize: typography.size.xs },
  cartRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], borderBottomWidth: 1, paddingVertical: spacing[2] },
  step: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  totals: { gap: 2, marginTop: spacing[2] },
  total: { fontSize: typography.size.lg },
});
