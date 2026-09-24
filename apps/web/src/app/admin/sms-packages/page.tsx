'use client';

import { useState } from 'react';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';

interface SmsPackage {
  id: string;
  key: string;
  name: string;
  credits: number;
  price: string;
  isActive: boolean;
}

const inputStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  borderColor: 'var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};

function TopUpForm() {
  const [studioId, setStudioId] = useState('');
  const [credits, setCredits] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await bffFetch<{ wallet: { balance: number } }>('sms-wallet/top-up', {
        method: 'POST',
        body: { studioId, credits: Number(credits), note: note || undefined },
      });
      setIsError(false);
      setMessage(`Yeni bakiye: ${res.wallet.balance} kredi`);
      setCredits('');
      setNote('');
    } catch (err) {
      setIsError(true);
      setMessage(err instanceof BffError ? err.message : 'Yükleme başarısız oldu');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="p-5 border space-y-3" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
      <h3 className="text-sm font-semibold">Manuel kredi yükleme</h3>
      <div className="grid grid-cols-3 gap-3">
        <input required placeholder="İşletme (studio) ID" value={studioId} onChange={(e) => setStudioId(e.target.value)} className="border px-3 py-2 text-sm" style={inputStyle} />
        <input required type="number" placeholder="Kredi (negatif = düşür)" value={credits} onChange={(e) => setCredits(e.target.value)} className="border px-3 py-2 text-sm" style={inputStyle} />
        <input placeholder="Not (opsiyonel)" value={note} onChange={(e) => setNote(e.target.value)} className="border px-3 py-2 text-sm" style={inputStyle} />
      </div>
      {message && <p className="text-xs" style={{ color: isError ? 'var(--color-danger)' : 'var(--color-success)' }}>{message}</p>}
      <button type="submit" disabled={submitting} className="px-4 py-2 text-sm font-medium" style={{ borderRadius: 'var(--radius-button)', backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>
        {submitting ? 'Yükleniyor...' : 'Kredi Yükle'}
      </button>
    </form>
  );
}

export default function SmsPackagesPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, error, forbidden } = useBff<{ items: SmsPackage[] }>('admin/sms-packages', null);
  const [form, setForm] = useState({ key: '', name: '', credits: '', price: '' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = () => setRefreshKey((k) => k + 1);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await bffFetch('admin/sms-packages', {
        method: 'POST',
        body: { key: form.key, name: form.name, credits: Number(form.credits), price: Number(form.price), isActive: true },
      });
      setForm({ key: '', name: '', credits: '', price: '' });
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
        <h2 className="text-xl font-bold">SMS Paketleri</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          Satılan SMS kredi paketleri ve manuel kredi yükleme
        </p>
      </div>

      <TopUpForm />

      <form onSubmit={submit} className="p-5 border space-y-3" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <h3 className="text-sm font-semibold">Paket oluştur / güncelle</h3>
        <div className="grid grid-cols-4 gap-3">
          <input required placeholder="Anahtar" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle} />
          <input required placeholder="Ad" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle} />
          <input required type="number" placeholder="Kredi" value={form.credits} onChange={(e) => setForm({ ...form, credits: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle} />
          <input required type="number" placeholder="Fiyat (TL)" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle} />
        </div>
        {formError && <p className="text-xs" style={{ color: 'var(--color-danger)' }}>{formError}</p>}
        <button type="submit" disabled={submitting} className="px-4 py-2 text-sm font-medium" style={{ borderRadius: 'var(--radius-button)', backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>
          {submitting ? 'Kaydediliyor...' : 'Kaydet'}
        </button>
      </form>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && data && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {data.items.map((p) => (
            <div key={p.id} className="p-5 border" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
              <h3 className="text-sm font-semibold">{p.name}</h3>
              <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>{p.credits.toLocaleString('tr-TR')} kredi · {Number(p.price).toLocaleString('tr-TR')} TL</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
