'use client';

import { useState } from 'react';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';

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
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, error, forbidden } = useBff<{ items: FeatureFlagRow[] }>('admin/feature-flags', null);
  const { data: catalog } = useBff<{ items: CatalogEntry[] }>('admin/feature-flags/catalog', null);
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
      setFormError(err instanceof BffError ? err.message : 'Kaydedilemedi');
    } finally {
      setSubmitting(false);
    }
  };

  if (forbidden) return <EmptyState title="Erişim yok" />;

  return (
    <div className="space-y-6" key={refreshKey}>
      <div>
        <h2 className="text-xl font-bold">Özellik Bayrakları</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          Çözümleme sırası: kiracı &gt; işletme türü &gt; global
        </p>
        {catalog && (
          <p className="text-xs mt-2" style={{ color: 'var(--color-text-muted)' }}>
            Bilinen anahtarlar: {catalog.items.map((c) => c.key).join(', ')}
          </p>
        )}
      </div>

      <form onSubmit={submit} className="p-5 border space-y-3" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <h3 className="text-sm font-semibold">Bayrak ayarla</h3>
        <div className="grid grid-cols-2 gap-3">
          <input required placeholder="Anahtar (ör: gamification)" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle} />
          <select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as FeatureFlagRow['scope'] })} className="border px-3 py-2 text-sm" style={inputStyle}>
            <option value="GLOBAL">Global</option>
            <option value="BUSINESS_TYPE">İşletme türü</option>
            <option value="TENANT">Kiracı</option>
          </select>
          {form.scope === 'BUSINESS_TYPE' && (
            <input required placeholder="İşletme türü şablon ID" value={form.businessTypeTemplateId} onChange={(e) => setForm({ ...form, businessTypeTemplateId: e.target.value })} className="border px-3 py-2 text-sm col-span-2" style={inputStyle} />
          )}
          {form.scope === 'TENANT' && (
            <input required placeholder="İşletme (studio) ID" value={form.studioId} onChange={(e) => setForm({ ...form, studioId: e.target.value })} className="border px-3 py-2 text-sm col-span-2" style={inputStyle} />
          )}
          <label className="flex items-center gap-2 text-sm col-span-2">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            Etkin
          </label>
        </div>
        {formError && <p className="text-xs" style={{ color: 'var(--color-danger)' }}>{formError}</p>}
        <button type="submit" disabled={submitting} className="px-4 py-2 text-sm font-medium" style={{ borderRadius: 'var(--radius-button)', backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>
          {submitting ? 'Kaydediliyor...' : 'Kaydet'}
        </button>
      </form>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!data || data.items.length === 0) && <EmptyState title="Henüz bayrak yok" />}
      {!loading && !error && data && data.items.length > 0 && (
        <div className="overflow-x-auto border" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--color-surface-muted)' }}>
                {['Anahtar', 'Kapsam', 'Hedef', 'Durum'].map((h) => (
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
                  <td className="px-3 py-2">{f.enabled ? 'Açık' : 'Kapalı'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
