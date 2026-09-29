'use client';

import { useState } from 'react';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { useT } from '@/components/i18n/I18nProvider';

interface FeatureFlagRow {
  id: string;
  key: string;
  scope: 'GLOBAL' | 'BUSINESS_TYPE' | 'TENANT';
  enabled: boolean;
  businessTypeTemplate: { key: string; name: string } | null;
  studio: { name: string; slug: string } | null;
}

interface CatalogEntry {
  key: string;
  description: string;
}

const inputStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  borderColor: 'var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};

export default function FeatureFlagsPage() {
  const t = useT();
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, error, forbidden } = useBff<{ items: FeatureFlagRow[] }>('admin/feature-flags', null, refreshKey);
  const { data: catalog } = useBff<{ items: CatalogEntry[] }>('admin/feature-flags/catalog', null, refreshKey);
  const [form, setForm] = useState({ key: '', scope: 'GLOBAL' as FeatureFlagRow['scope'], businessTypeTemplateId: '', studioId: '', enabled: true });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = () => setRefreshKey((k) => k + 1);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await bffFetch('admin/feature-flags', {
        method: 'POST',
        body: {
          key: form.key,
          scope: form.scope,
          enabled: form.enabled,
          ...(form.scope === 'BUSINESS_TYPE' ? { businessTypeTemplateId: form.businessTypeTemplateId } : {}),
          ...(form.scope === 'TENANT' ? { studioId: form.studioId } : {}),
        },
      });
      refresh();
    } catch (err) {
      setFormError(err instanceof BffError ? err.message : t('adminFeatureFlags.form.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  if (forbidden) return <EmptyState title={t('adminFeatureFlags.accessDenied')} />;

  return (
    <div className="space-y-6" key={refreshKey}>
      <div>
        <h2 className="text-xl font-bold">{t('adminFeatureFlags.title')}</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          {t('adminFeatureFlags.subtitle')}
        </p>
        {catalog && (
          <p className="text-xs mt-2" style={{ color: 'var(--color-text-muted)' }}>
            {t('adminFeatureFlags.knownKeys', { keys: catalog.items.map((c) => c.key).join(', ') })}
          </p>
        )}
      </div>

      <form onSubmit={submit} className="p-5 border space-y-3" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <h3 className="text-sm font-semibold">{t('adminFeatureFlags.form.title')}</h3>
        <div className="grid grid-cols-2 gap-3">
          <input required placeholder={t('adminFeatureFlags.form.key')} value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle} />
          <select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as FeatureFlagRow['scope'] })} className="border px-3 py-2 text-sm" style={inputStyle}>
            <option value="GLOBAL">{t('adminFeatureFlags.form.scope.GLOBAL')}</option>
            <option value="BUSINESS_TYPE">{t('adminFeatureFlags.form.scope.BUSINESS_TYPE')}</option>
            <option value="TENANT">{t('adminFeatureFlags.form.scope.TENANT')}</option>
          </select>
          {form.scope === 'BUSINESS_TYPE' && (
            <input required placeholder={t('adminFeatureFlags.form.businessTypeId')} value={form.businessTypeTemplateId} onChange={(e) => setForm({ ...form, businessTypeTemplateId: e.target.value })} className="border px-3 py-2 text-sm col-span-2" style={inputStyle} />
          )}
          {form.scope === 'TENANT' && (
            <input required placeholder={t('adminFeatureFlags.form.studioId')} value={form.studioId} onChange={(e) => setForm({ ...form, studioId: e.target.value })} className="border px-3 py-2 text-sm col-span-2" style={inputStyle} />
          )}
          <label className="flex items-center gap-2 text-sm col-span-2">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            {t('adminFeatureFlags.form.enabled')}
          </label>
        </div>
        {formError && <p className="text-xs" style={{ color: 'var(--color-danger)' }}>{formError}</p>}
        <button type="submit" disabled={submitting} className="px-4 py-2 text-sm font-medium" style={{ borderRadius: 'var(--radius-button)', backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>
          {submitting ? t('adminFeatureFlags.form.submitting') : t('adminFeatureFlags.form.submit')}
        </button>
      </form>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!data || data.items.length === 0) && <EmptyState title={t('adminFeatureFlags.empty')} />}
      {!loading && !error && data && data.items.length > 0 && (
        <div className="overflow-x-auto border" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--color-surface-muted)' }}>
                {[t('adminFeatureFlags.table.key'), t('adminFeatureFlags.table.scope'), t('adminFeatureFlags.table.target'), t('adminFeatureFlags.table.status')].map((h) => (
                  <th key={h} className="text-left px-3 py-2 font-medium" style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.map((f) => (
                <tr key={f.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="px-3 py-2 font-medium">{f.key}</td>
                  <td className="px-3 py-2">{f.scope}</td>
                  <td className="px-3 py-2" style={{ color: 'var(--color-text-muted)' }}>
                    {f.businessTypeTemplate?.name ?? f.studio?.name ?? '-'}
                  </td>
                  <td className="px-3 py-2">{f.enabled ? t('adminFeatureFlags.status.on') : t('adminFeatureFlags.status.off')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
