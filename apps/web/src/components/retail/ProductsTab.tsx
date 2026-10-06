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
import { Card, CardContent, Checkbox, FieldGroup, Input, Select, Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui';
import { StockDialog } from './StockDialog';
import { useConfirm } from '@/components/ui';

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
      <form onSubmit={submit} className="grid gap-3">
        <FieldGroup label={t('retail.form.name')}>
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
        </FieldGroup>
        <FieldGroup label={t('retail.form.category')}>
          <Select value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
            <option value="">{t('retail.form.noCategory')}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </FieldGroup>
        <div className="grid grid-cols-2 gap-3">
          <FieldGroup label={t('retail.form.sku')}>
            <Input value={form.sku} onChange={(e) => set('sku', e.target.value)} />
          </FieldGroup>
          <FieldGroup label={t('retail.form.barcode')}>
            <Input value={form.barcode} onChange={(e) => set('barcode', e.target.value)} />
          </FieldGroup>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FieldGroup label={t('retail.form.price', { currency })}>
            <Input inputMode="decimal" value={form.price} onChange={(e) => set('price', e.target.value)} />
          </FieldGroup>
          <FieldGroup label={t('retail.form.taxRate')}>
            <Input inputMode="decimal" value={form.taxRate} onChange={(e) => set('taxRate', e.target.value)} />
          </FieldGroup>
        </div>
        <p className="ui-caption">
          {settings?.pricesIncludeTax ? t('retail.form.priceHintInclusive') : t('retail.form.priceHintExclusive')}{' '}
          {t('retail.form.taxRateHint', { rate: settings?.defaultTaxRate ?? '0' })}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <FieldGroup label={t('retail.form.costPrice', { currency })}>
            <Input inputMode="decimal" value={form.costPrice} onChange={(e) => set('costPrice', e.target.value)} />
          </FieldGroup>
          <FieldGroup label={t('retail.form.lowStockThreshold')}>
            <Input inputMode="numeric" value={form.lowStockThreshold} onChange={(e) => set('lowStockThreshold', e.target.value)} />
          </FieldGroup>
        </div>
        <FieldGroup label={t('retail.form.imageUrl')}>
          <Input value={form.imageUrl} onChange={(e) => set('imageUrl', e.target.value)} />
        </FieldGroup>
        <Checkbox checked={form.trackStock} onChange={(e) => set('trackStock', e.target.checked)} label={t('retail.form.trackStock')} />
        <Checkbox checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} label={t('retail.form.isActive')} />
        {error && <p className="ui-caption ui-text-error">{error}</p>}
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
    <Card as="section">
      <CardContent>
        <h3 className="ui-heading">{t('retail.categories.title')}</h3>
        {categories.length === 0 ? (
          <p className="ui-caption">{t('retail.categories.empty')}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <li key={c.id} className="pui-chip pui-soft pui-muted pui-rounded-full flex items-center gap-2">
                <span>{c.name}</span>
                <span className="ui-caption">{t('retail.categories.productCount', { count: c.productCount })}</span>
                <PermissionButton required={['retail.manage']} variant="ghost" onClick={() => remove(c.id)} aria-label={`${t('retail.products.delete')} ${c.name}`}>
                  {t('retail.products.delete')}
                </PermissionButton>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
          <FieldGroup label={t('retail.categories.name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </FieldGroup>
          <PermissionButton required={['retail.manage']} type="submit" variant="secondary">
            {t('retail.categories.add')}
          </PermissionButton>
        </form>
        {error && <p className="ui-caption ui-text-error">{error}</p>}
      </CardContent>
    </Card>
  );
}

/** Store catalogue: products with stock per branch, the product form, stock actions and categories. */
export function ProductsTab() {
  const t = useT();
  const { confirm } = useConfirm();
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
    if (!(await confirm({ message: t('retail.products.confirmDelete'), danger: true }))) return;
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
        <Input
          type="search"
          aria-label={t('retail.products.search')}
          placeholder={t('retail.products.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm"
        />
        <PermissionButton required={['retail.manage']} variant="primary" onClick={() => setEditing('new')}>
          {t('retail.products.new')}
        </PermissionButton>
      </div>
      {notice && (
        <p className="ui-caption" role="status">
          {notice}
        </p>
      )}

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && products && products.length === 0 && (
        <EmptyState title={t('retail.products.empty.title')} description={t('retail.products.empty.description')} />
      )}
      {!loading && !error && products && products.length > 0 && (
        <Card className="overflow-x-auto">
          <Table data-testid="retail-products">
            <Thead>
              <Tr>
                {[
                  t('retail.products.col.name'),
                  t('retail.products.col.category'),
                  t('retail.products.col.price'),
                  t('retail.products.col.tax'),
                  t('retail.products.col.stock'),
                  t('retail.products.col.status'),
                  '',
                ].map((h, i) => (
                  <Th key={i} className="whitespace-nowrap">
                    {h}
                  </Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {products.map((p) => (
                <Tr key={p.id}>
                  <Td>
                    <div className="ui-strong">{p.name}</div>
                    {(p.sku || p.barcode) && <div className="ui-caption">{[p.sku, p.barcode].filter(Boolean).join(' / ')}</div>}
                  </Td>
                  <Td>{p.categoryName ?? '-'}</Td>
                  <Td className="whitespace-nowrap">{formatMoney(p.price)}</Td>
                  <Td className="whitespace-nowrap">
                    {p.taxRate === null ? t('retail.products.defaultTax', { rate: p.effectiveTaxRate }) : t('retail.products.taxValue', { rate: p.taxRate })}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {p.trackStock ? (
                      <span className="flex items-center gap-2">
                        {p.totalStock}
                        {p.lowStock && <Badge tone="warning">{t('retail.products.lowStock')}</Badge>}
                      </span>
                    ) : (
                      <span className="ui-text-muted">{t('retail.products.untracked')}</span>
                    )}
                  </Td>
                  <Td>
                    <Badge tone={p.isActive ? 'success' : 'neutral'}>{p.isActive ? t('retail.products.active') : t('retail.products.inactive')}</Badge>
                  </Td>
                  <Td className="text-right whitespace-nowrap space-x-1">
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
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Card>
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
