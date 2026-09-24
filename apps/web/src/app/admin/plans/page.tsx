'use client';

import { useState } from 'react';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';

interface Plan {
  id: string;
  key: string;
  name: string;
  priceMonthly: string;
  limits: { maxBranches?: number; maxActiveMembers?: number; maxStaff?: number; maxSmsPerMonth?: number };
  isActive: boolean;
}

const inputStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  borderColor: 'var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};

export default function PlansPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, error, forbidden } = useBff<{ items: Plan[] }>('admin/plans', null);
  const [form, setForm] = useState({ key: '', name: '', priceMonthly: '', maxBranches: '', maxActiveMembers: '', maxStaff: '' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = () => setRefreshKey((k) => k + 1);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await bffFetch('admin/plans', {
        method: 'POST',
        body: {
          key: form.key,
          name: form.name,
          priceMonthly: Number(form.priceMonthly),
          limits: {
            ...(form.maxBranches ? { maxBranches: Number(form.maxBranches) } : {}),
            ...(form.maxActiveMembers ? { maxActiveMembers: Number(form.maxActiveMembers) } : {}),
            ...(form.maxStaff ? { maxStaff: Number(form.maxStaff) } : {}),
          },
          isActive: true,
        },
      });
      setForm({ key: '', name: '', priceMonthly: '', maxBranches: '', maxActiveMembers: '', maxStaff: '' });
      refresh();
    } catch (err) {
      setFormError(err instanceof BffError ? err.message : 'Plan kaydedilemedi');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (plan: Plan) => {
    await bffFetch(`admin/plans/${plan.key}/${plan.isActive ? 'deactivate' : 'activate'}`, { method: 'POST' });
    refresh();
  };

  if (forbidden) return <EmptyState title="Erişim yok" />;

  return (
    <div className="space-y-6" key={refreshKey}>
      <div>
        <h2 className="text-xl font-bold">Planlar</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          Şube, üye ve personel limitleri kiracının aktif aboneliğinden okunur
        </p>
      </div>

      <form onSubmit={submit} className="p-5 border space-y-3" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <h3 className="text-sm font-semibold">Plan oluştur / güncelle</h3>
        <div className="grid grid-cols-3 gap-3">
          <input required placeholder="Anahtar (ör: enterprise)" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle} />
          <input required placeholder="Ad" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle} />
          <input required type="number" placeholder="Aylık fiyat (TL)" value={form.priceMonthly} onChange={(e) => setForm({ ...form, priceMonthly: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle} />
          <input type="number" placeholder="Max şube" value={form.maxBranches} onChange={(e) => setForm({ ...form, maxBranches: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle} />
          <input type="number" placeholder="Max aktif üye" value={form.maxActiveMembers} onChange={(e) => setForm({ ...form, maxActiveMembers: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle} />
          <input type="number" placeholder="Max personel" value={form.maxStaff} onChange={(e) => setForm({ ...form, maxStaff: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle} />
        </div>
        {formError && <p className="text-xs" style={{ color: 'var(--color-danger)' }}>{formError}</p>}
        <button type="submit" disabled={submitting} className="px-4 py-2 text-sm font-medium" style={{ borderRadius: 'var(--radius-button)', backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>
          {submitting ? 'Kaydediliyor...' : 'Kaydet'}
        </button>
      </form>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.items.map((p) => (
            <div key={p.id} className="p-5 border" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
              <div className="flex items-start justify-between">
                <h3 className="text-sm font-semibold">{p.name}</h3>
                <span
                  className="px-2 py-0.5 text-xs font-medium"
                  style={{ borderRadius: 'var(--radius-chip)', backgroundColor: p.isActive ? 'var(--color-surface-muted)' : 'var(--color-danger)', color: p.isActive ? 'var(--color-text-secondary)' : 'var(--color-on-primary)' }}
                >
                  {p.isActive ? 'Aktif' : 'Pasif'}
                </span>
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>{p.key} · {Number(p.priceMonthly).toLocaleString('tr-TR')} TL/ay</p>
              <ul className="text-xs mt-3 space-y-1" style={{ color: 'var(--color-text-secondary)' }}>
                <li>Şube: {p.limits.maxBranches ?? 'sınırsız'}</li>
                <li>Aktif üye: {p.limits.maxActiveMembers ?? 'sınırsız'}</li>
                <li>Personel: {p.limits.maxStaff ?? 'sınırsız'}</li>
              </ul>
              <button onClick={() => toggleActive(p)} className="text-xs font-medium underline mt-3" style={{ color: 'var(--color-text-secondary)' }}>
                {p.isActive ? 'Pasifleştir' : 'Etkinleştir'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
