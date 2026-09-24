'use client';

import { useState } from 'react';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';

interface BusinessType {
  id: string;
  key: string;
  name: string;
  enabledModules: string[];
  isActive: boolean;
}

const inputStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  borderColor: 'var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};

export default function BusinessTypesPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, error, forbidden } = useBff<{ items: BusinessType[] }>('admin/business-type-templates', null);
  const [form, setForm] = useState({ key: '', name: '', serviceTypeNames: '', resourceTypeNames: '', enabledModules: '' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = () => setRefreshKey((k) => k + 1);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await bffFetch('admin/business-type-templates', {
        method: 'POST',
        body: {
          key: form.key,
          name: form.name,
          vocabulary: {},
          defaults: {
            serviceTypeNames: form.serviceTypeNames.split(',').map((s) => s.trim()).filter(Boolean),
            resourceTypeNames: form.resourceTypeNames.split(',').map((s) => s.trim()).filter(Boolean),
          },
          enabledModules: form.enabledModules.split(',').map((s) => s.trim()).filter(Boolean),
          isActive: true,
        },
      });
      setForm({ key: '', name: '', serviceTypeNames: '', resourceTypeNames: '', enabledModules: '' });
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
        <h2 className="text-xl font-bold">İşletme Türü Şablonları</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          Varsayılan hizmet/kaynak türleri, kelime dağarcığı ve etkin modüller. Yeni bir kiracıya "Uygula" ile aktarılır.
        </p>
      </div>

      <form onSubmit={submit} className="p-5 border space-y-3" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <h3 className="text-sm font-semibold">Şablon oluştur / güncelle</h3>
        <div className="grid grid-cols-2 gap-3">
          <input required placeholder="Anahtar (ör: yoga_studio)" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle} />
          <input required placeholder="Ad" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle} />
          <input placeholder="Hizmet türleri (virgülle)" value={form.serviceTypeNames} onChange={(e) => setForm({ ...form, serviceTypeNames: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle} />
          <input placeholder="Kaynak türleri (virgülle)" value={form.resourceTypeNames} onChange={(e) => setForm({ ...form, resourceTypeNames: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle} />
          <input placeholder="Etkin modüller (virgülle)" value={form.enabledModules} onChange={(e) => setForm({ ...form, enabledModules: e.target.value })} className="border px-3 py-2 text-sm col-span-2" style={inputStyle} />
        </div>
        {formError && <p className="text-xs" style={{ color: 'var(--color-danger)' }}>{formError}</p>}
        <button type="submit" disabled={submitting} className="px-4 py-2 text-sm font-medium" style={{ borderRadius: 'var(--radius-button)', backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>
          {submitting ? 'Kaydediliyor...' : 'Kaydet'}
        </button>
      </form>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {data.items.map((bt) => (
            <div key={bt.id} className="p-5 border" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
              <h3 className="text-sm font-semibold">{bt.name}</h3>
              <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>{bt.key}</p>
              <p className="text-xs mt-2" style={{ color: 'var(--color-text-secondary)' }}>Modüller: {bt.enabledModules.join(', ') || '-'}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
