'use client';

import { useEffect, useState } from 'react';
import type { ProductCategoryDTO, ProductDTO, RetailSettingsDTO } from '@platform/shared';
import { useDashboardSession, useFormatMoney } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { bffFetch } from '@/lib/session/client';
import { useBff } from '@/lib/session/use-bff';
import { retailErrorMessage } from '@/lib/retail/errors';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { PermissionButton } from '@/components/common/PermissionButton';
import { Badge } from '@/components/common/Badge';
import { Modal } from '@/components/common/Modal';
import { fieldClass, fieldStyle, headRowStyle, labelStyle, rowStyle, sectionStyle, tableWrapStyle } from './styles';
import { StockDialog } from './StockDialog';

interface ProductFormState {
  name: string;
  categoryId: string;
  sku: string;
  barcode: string;
  price: string;
  taxRate: string;
  costPrice: string;
  trackStock: boolean;
  isActive: boolean;
  lowStockThreshold: string;
  imageUrl: string;
}

const EMPTY_FORM: ProductFormState = {
  name: '',
  categoryId: '',
  sku: '',
  barcode: '',
  price: '',
  taxRate: '',
  costPrice: '',
  trackStock: true,
  isActive: true,
  lowStockThreshold: '',
  imageUrl: '',
};

const MONEY_RE = /^\d{1,10}(\.\d{1,2})?$/;

function formFromProduct(p: ProductDTO): ProductFormState {
  return {
    name: p.name,
    categoryId: p.categoryId ?? '',
    sku: p.sku ?? '',
    barcode: p.barcode ?? '',
    price: p.price,
    taxRate: p.taxRate ?? '',
    costPrice: p.costPrice ?? '',
    trackStock: p.trackStock,
    isActive: p.isActive,
    lowStockThreshold: p.lowStockThreshold === null ? '' : String(p.lowStockThreshold),
    imageUrl: p.imageUrl ?? '',
  };
}

function ProductDialog({
  studioId,
  product,
  categories,
  settings,
  onClose,
  onDone,
}: {
  studioId: string;
  product: ProductDTO | null;
  categories: ProductCategoryDTO[];
  settings: RetailSettingsDTO | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const [form, setForm] = useState<ProductFormState>(product ? formFromProduct(product) : EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof ProductFormState>(key: K, value: ProductFormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const currency = settings?.currency ?? '';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const price = form.price.trim().replace(',', '.');
    const cost = form.costPrice.trim().replace(',', '.');
    if (!form.name.trim() || !MONEY_RE.test(price) || (cost && !MONEY_RE.test(cost))) {
      setError(t('retail.form.invalid'));
      return;
    }
    const taxRate = form.taxRate.trim() === '' ? null : Number(form.taxRate.replace(',', '.'));
    const threshold = form.lowStockThreshold.trim() === '' ? null : Number(form.lowStockThreshold);
    const body = {
      name: form.name.trim(),
      categoryId: form.categoryId || null,
      sku: form.sku.trim() || null,
      barcode: form.barcode.trim() || null,
      price,
      taxRate: taxRate !== null && Number.isFinite(taxRate) ? taxRate : null,
      costPrice: cost || null,
      trackStock: form.trackStock,
      isActive: form.isActive,
      lowStockThreshold: threshold !== null && Number.isInteger(threshold) ? threshold : null,
      imageUrl: form.imageUrl.trim() || null,
    };
    setSaving(true);
    setError(null);
    try {
      if (product) {
        await bffFetch(`studios/${studioId}/retail/products/${product.id}`, { method: 'PATCH', studioId, body });
      } else {
        await bffFetch(`studios/${studioId}/retail/products`, { method: 'POST', studioId, body });
      }
      onDone();
    } catch (err) {
      setError(retailErrorMessage(t, err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={product ? t('retail.products.edit') : t('retail.products.new')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-xs space-y-1" style={labelStyle}>
          <span>{t('retail.form.name')}</span>
          <input value={form.name} onChange={(e) => set('name', e.target.value)} className={fieldClass} style={fieldStyle} />
        </label>
        <label className="block text-xs space-y-1" style={labelStyle}>
          <span>{t('retail.form.category')}</span>
          <select value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)} className={fieldClass} style={fieldStyle}>
            <option value="">{t('retail.form.noCategory')}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs space-y-1" style={labelStyle}>
            <span>{t('retail.form.sku')}</span>
            <input value={form.sku} onChange={(e) => set('sku', e.target.value)} className={fieldClass} style={fieldStyle} />
          </label>
          <label className="block text-xs space-y-1" style={labelStyle}>
            <span>{t('retail.form.barcode')}</span>
            <input value={form.barcode} onChange={(e) => set('barcode', e.target.value)} className={fieldClass} style={fieldStyle} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs space-y-1" style={labelStyle}>
            <span>{t('retail.form.price', { currency })}</span>
            <input inputMode="decimal" value={form.price} onChange={(e) => set('price', e.target.value)} className={fieldClass} style={fieldStyle} />
          </label>
          <label className="block text-xs space-y-1" style={labelStyle}>
            <span>{t('retail.form.taxRate')}</span>
            <input inputMode="decimal" value={form.taxRate} onChange={(e) => set('taxRate', e.target.value)} className={fieldClass} style={fieldStyle} />
          </label>
        </div>
        <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
          {settings?.pricesIncludeTax ? t('retail.form.priceHintInclusive') : t('retail.form.priceHintExclusive')}{' '}
          {t('retail.form.taxRateHint', { rate: settings?.defaultTaxRate ?? '0' })}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs space-y-1" style={labelStyle}>
            <span>{t('retail.form.costPrice', { currency })}</span>
            <input inputMode="decimal" value={form.costPrice} onChange={(e) => set('costPrice', e.target.value)} className={fieldClass} style={fieldStyle} />
          </label>
          <label className="block text-xs space-y-1" style={labelStyle}>
            <span>{t('retail.form.lowStockThreshold')}</span>
            <input inputMode="numeric" value={form.lowStockThreshold} onChange={(e) => set('lowStockThreshold', e.target.value)} className={fieldClass} style={fieldStyle} />
          </label>
        </div>
        <label className="block text-xs space-y-1" style={labelStyle}>
          <span>{t('retail.form.imageUrl')}</span>
          <input value={form.imageUrl} onChange={(e) => set('imageUrl', e.target.value)} className={fieldClass} style={fieldStyle} />
        </label>
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-primary)' }}>
          <input type="checkbox" checked={form.trackStock} onChange={(e) => set('trackStock', e.target.checked)} /> {t('retail.form.trackStock')}
        </label>
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-primary)' }}>
          <input type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} /> {t('retail.form.isActive')}
        </label>
        {error && (
          <p className="text-xs" style={{ color: 'var(--color-danger, #b42318)' }}>
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <PermissionButton type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </PermissionButton>
          <PermissionButton required={['retail.manage']} type="submit" variant="primary" disabled={saving}>
            {saving ? t('retail.form.saving') : t('retail.form.save')}
          </PermissionButton>
        </div>
      </form>
    </Modal>
  );
}

function CategoriesSection({ studioId, categories, onChange }: { studioId: string; categories: ProductCategoryDTO[]; onChange: () => void }) {
  const t = useT();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    try {
      await bffFetch(`studios/${studioId}/retail/categories`, { method: 'POST', studioId, body: { name: name.trim() } });
      setName('');
      onChange();
    } catch (err) {
      setError(retailErrorMessage(t, err));
    }
  }

  async function remove(id: string) {
    try {
      await bffFetch(`studios/${studioId}/retail/categories/${id}`, { method: 'DELETE', studioId });
      onChange();
    } catch (err) {
      setError(retailErrorMessage(t, err));
    }
  }

  return (
    <section className="p-4 space-y-3" style={sectionStyle}>
      <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
        {t('retail.categories.title')}
      </h3>
      {categories.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {t('retail.categories.empty')}
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center gap-2 text-xs px-2.5 py-1" style={{ ...fieldStyle, borderRadius: 'var(--radius-chip)' }}>
              <span>{c.name}</span>
              <span style={{ color: 'var(--color-text-muted)' }}>{t('retail.categories.productCount', { count: c.productCount })}</span>
              <PermissionButton required={['retail.manage']} variant="ghost" onClick={() => remove(c.id)} aria-label={`${t('retail.products.delete')} ${c.name}`}>
                {t('retail.products.delete')}
              </PermissionButton>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <label className="text-xs space-y-1" style={labelStyle}>
          <span className="block">{t('retail.categories.name')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="text-sm px-3 py-1.5" style={fieldStyle} />
        </label>
        <PermissionButton required={['retail.manage']} type="submit" variant="secondary">
          {t('retail.categories.add')}
        </PermissionButton>
      </form>
      {error && (
        <p className="text-xs" style={{ color: 'var(--color-danger, #b42318)' }}>
          {error}
        </p>
      )}
    </section>
  );
}

/** Store catalogue: products with stock per branch, the product form, stock actions and categories. */
export function ProductsTab() {
  const t = useT();
  const formatMoney = useFormatMoney();
  const { activeStudioId } = useDashboardSession();
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<ProductDTO[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProductDTO | 'new' | null>(null);
  const [stockFor, setStockFor] = useState<ProductDTO | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const { data: categoryData } = useBff<{ items: ProductCategoryDTO[] }>(`studios/${activeStudioId}/retail/categories`, activeStudioId, reloadKey);
  const { data: settings } = useBff<RetailSettingsDTO>(`studios/${activeStudioId}/retail/settings`, activeStudioId);
  const categories = categoryData?.items ?? [];
  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    if (!activeStudioId) return;
    setLoading(true);
    setError(null);
    const qs = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
    bffFetch<{ items: ProductDTO[] }>(`studios/${activeStudioId}/retail/products${qs}`, { studioId: activeStudioId })
      .then((res) => setProducts(res.items))
      .catch((err) => setError(retailErrorMessage(t, err, 'retail.loadFailed')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStudioId, search, reloadKey]);

  async function remove(product: ProductDTO) {
    if (!window.confirm(t('retail.products.confirmDelete'))) return;
    try {
      const res = await bffFetch<{ deleted: boolean; deactivated: boolean }>(`studios/${activeStudioId}/retail/products/${product.id}`, {
        method: 'DELETE',
        studioId: activeStudioId,
      });
      setNotice(res.deactivated ? t('retail.products.deactivated') : null);
      reload();
    } catch (err) {
      setNotice(retailErrorMessage(t, err));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <input
          type="search"
          aria-label={t('retail.products.search')}
          placeholder={t('retail.products.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="text-sm px-3 py-1.5 w-full max-w-sm"
          style={fieldStyle}
        />
        <PermissionButton required={['retail.manage']} variant="primary" onClick={() => setEditing('new')}>
          {t('retail.products.new')}
        </PermissionButton>
      </div>
      {notice && (
        <p className="text-xs" role="status" style={{ color: 'var(--color-text-secondary)' }}>
          {notice}
        </p>
      )}

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && products && products.length === 0 && (
        <EmptyState title={t('retail.products.empty.title')} description={t('retail.products.empty.description')} />
      )}
      {!loading && !error && products && products.length > 0 && (
        <div className="border overflow-x-auto" style={tableWrapStyle}>
          <table className="w-full text-sm" data-testid="retail-products">
            <thead>
              <tr style={headRowStyle}>
                {[
                  t('retail.products.col.name'),
                  t('retail.products.col.category'),
                  t('retail.products.col.price'),
                  t('retail.products.col.tax'),
                  t('retail.products.col.stock'),
                  t('retail.products.col.status'),
                  '',
                ].map((h, i) => (
                  <th key={i} className="text-left px-4 py-2.5 font-medium whitespace-nowrap" style={labelStyle}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-t" style={rowStyle}>
                  <td className="px-4 py-2.5" style={{ color: 'var(--color-text-primary)' }}>
                    <div className="font-medium">{p.name}</div>
                    {(p.sku || p.barcode) && (
                      <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                        {[p.sku, p.barcode].filter(Boolean).join(' / ')}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5" style={labelStyle}>
                    {p.categoryName ?? '-'}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: 'var(--color-text-primary)' }}>
                    {formatMoney(p.price)}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap" style={labelStyle}>
                    {p.taxRate === null ? t('retail.products.defaultTax', { rate: p.effectiveTaxRate }) : t('retail.products.taxValue', { rate: p.taxRate })}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: 'var(--color-text-primary)' }}>
                    {p.trackStock ? (
                      <span className="flex items-center gap-2">
                        {p.totalStock}
                        {p.lowStock && <Badge tone="warning">{t('retail.products.lowStock')}</Badge>}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--color-text-muted)' }}>{t('retail.products.untracked')}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={p.isActive ? 'success' : 'neutral'}>{p.isActive ? t('retail.products.active') : t('retail.products.inactive')}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap space-x-1">
                    {p.trackStock && (
                      <PermissionButton required={['retail.manage']} variant="secondary" onClick={() => setStockFor(p)}>
                        {t('retail.products.stockAction')}
                      </PermissionButton>
                    )}
                    <PermissionButton required={['retail.manage']} variant="secondary" onClick={() => setEditing(p)}>
                      {t('retail.products.edit')}
                    </PermissionButton>
                    <PermissionButton required={['retail.manage']} variant="danger" onClick={() => remove(p)}>
                      {t('retail.products.delete')}
                    </PermissionButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CategoriesSection studioId={activeStudioId} categories={categories} onChange={reload} />

      {editing && (
        <ProductDialog
          studioId={activeStudioId}
          product={editing === 'new' ? null : editing}
          categories={categories}
          settings={settings}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {stockFor && (
        <StockDialog
          studioId={activeStudioId}
          product={stockFor}
          onClose={() => setStockFor(null)}
          onDone={() => {
            setStockFor(null);
            reload();
          }}
        />
      )}
    </div>
  );
}
