'use client';

import { useState } from 'react';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';

interface TenantListItem {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  businessTypeTemplateKey: string | null;
  planKey: string | null;
  subscriptionStatus: string | null;
  branchCount: number;
  activeMemberCount: number;
  staffCount: number;
}

const inputStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  borderColor: 'var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};

function CreateTenantForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    slug: '',
    businessTypeTemplateKey: '',
    planKey: '',
    ownerFirstName: '',
    ownerLastName: '',
    ownerPhone: '',
  });

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await bffFetch('admin/tenants', { method: 'POST', body: { ...form, ownerChannel: 'SHOWN' } });
      setOpen(false);
      setForm({ name: '', slug: '', businessTypeTemplateKey: '', planKey: '', ownerFirstName: '', ownerLastName: '', ownerPhone: '' });
      onCreated();
    } catch (err) {
      setError(err instanceof BffError ? err.message : 'İşletme oluşturulamadı');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-4 py-2 text-sm font-medium"
        style={{ borderRadius: 'var(--radius-button)', backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }}
      >
        Yeni İşletme Oluştur
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="p-5 border space-y-3"
      style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
    >
      <h3 className="text-sm font-semibold">Yeni İşletme</h3>
      <div className="grid grid-cols-2 gap-3">
        <input required placeholder="İşletme adı" value={form.name} onChange={set('name')} className="border px-3 py-2 text-sm" style={inputStyle} />
        <input required placeholder="Slug (ör: yeni-studyo)" value={form.slug} onChange={set('slug')} className="border px-3 py-2 text-sm" style={inputStyle} />
        <input
          required
          placeholder="İşletme türü anahtarı (ör: pilates_studio)"
          value={form.businessTypeTemplateKey}
          onChange={set('businessTypeTemplateKey')}
          className="border px-3 py-2 text-sm"
          style={inputStyle}
        />
        <input required placeholder="Plan anahtarı (ör: starter)" value={form.planKey} onChange={set('planKey')} className="border px-3 py-2 text-sm" style={inputStyle} />
        <input required placeholder="Sahibin adı" value={form.ownerFirstName} onChange={set('ownerFirstName')} className="border px-3 py-2 text-sm" style={inputStyle} />
        <input required placeholder="Sahibin soyadı" value={form.ownerLastName} onChange={set('ownerLastName')} className="border px-3 py-2 text-sm" style={inputStyle} />
        <input required placeholder="Sahibin telefonu (05XX...)" value={form.ownerPhone} onChange={set('ownerPhone')} className="border px-3 py-2 text-sm" style={inputStyle} />
      </div>
      {error && <p className="text-xs" style={{ color: 'var(--color-danger)' }}>{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 text-sm font-medium"
          style={{ borderRadius: 'var(--radius-button)', backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }}
        >
          {submitting ? 'Oluşturuluyor...' : 'Oluştur ve Davet Gönder'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          Vazgeç
        </button>
      </div>
    </form>
  );
}

export default function TenantsPage() {
  const { data, loading, error, forbidden } = useBff<{ items: TenantListItem[] }>('admin/tenants', null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = () => setRefreshKey((k) => k + 1);

  const toggleActive = async (tenant: TenantListItem) => {
    setActionError(null);
    try {
      await bffFetch(`admin/tenants/${tenant.id}/${tenant.isActive ? 'suspend' : 'reactivate'}`, { method: 'POST' });
      refresh();
    } catch (err) {
      setActionError(err instanceof BffError ? err.message : 'İşlem başarısız oldu');
    }
  };

  if (forbidden) return <EmptyState title="Erişim yok" description="Bu sayfayı görüntüleme yetkiniz yok." />;

  return (
    <div className="space-y-6" key={refreshKey}>
      <div>
        <h2 className="text-xl font-bold">İşletmeler</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          Tüm kiracıların listesi, oluşturma ve askıya alma
        </p>
      </div>

      <CreateTenantForm onCreated={refresh} />
      {actionError && <p className="text-xs" style={{ color: 'var(--color-danger)' }}>{actionError}</p>}

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!data || data.items.length === 0) && <EmptyState title="Henüz işletme yok" />}
      {!loading && !error && data && data.items.length > 0 && (
        <div className="overflow-x-auto border" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--color-surface-muted)' }}>
                {['İsim', 'Slug', 'İşletme Türü', 'Plan', 'Şube', 'Üye', 'Personel', 'Durum', ''].map((h) => (
                  <th key={h} className="text-left px-3 py-2 font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.map((t) => (
                <tr key={t.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="px-3 py-2 font-medium">{t.name}</td>
                  <td className="px-3 py-2" style={{ color: 'var(--color-text-muted)' }}>{t.slug}</td>
                  <td className="px-3 py-2">{t.businessTypeTemplateKey ?? '-'}</td>
                  <td className="px-3 py-2">{t.planKey ?? '-'} {t.subscriptionStatus ? `(${t.subscriptionStatus})` : ''}</td>
                  <td className="px-3 py-2">{t.branchCount}</td>
                  <td className="px-3 py-2">{t.activeMemberCount}</td>
                  <td className="px-3 py-2">{t.staffCount}</td>
                  <td className="px-3 py-2">
                    <span
                      className="px-2 py-0.5 text-xs font-medium"
                      style={{
                        borderRadius: 'var(--radius-chip)',
                        backgroundColor: t.isActive ? 'var(--color-surface-muted)' : 'var(--color-danger)',
                        color: t.isActive ? 'var(--color-text-secondary)' : 'var(--color-on-primary)',
                      }}
                    >
                      {t.isActive ? 'Aktif' : 'Askıda'}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <button onClick={() => toggleActive(t)} className="text-xs font-medium underline" style={{ color: 'var(--color-text-secondary)' }}>
                      {t.isActive ? 'Askıya al' : 'Yeniden etkinleştir'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
