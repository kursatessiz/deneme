'use client';

import { useState } from 'react';
import { useBff } from '@/lib/session/use-bff';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
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
  const t = useT();
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
      setMessage(t('adminSmsPackages.topUp.newBalance', { balance: res.wallet.balance }));
      setCredits('');
      setNote('');
    } catch (err) {
      setIsError(true);
      setMessage(err instanceof BffError ? err.message : t('adminSmsPackages.topUp.failed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="p-5 border space-y-3" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
      <h3 className="text-sm font-semibold">{t('adminSmsPackages.topUp.title')}</h3>
      <div className="grid grid-cols-3 gap-3">
        <input required placeholder={t('adminSmsPackages.topUp.studioId')} value={studioId} onChange={(e) => setStudioId(e.target.value)} className="border px-3 py-2 text-sm" style={inputStyle} />
        <input required type="number" placeholder={t('adminSmsPackages.topUp.credits')} value={credits} onChange={(e) => setCredits(e.target.value)} className="border px-3 py-2 text-sm" style={inputStyle} />
        <input placeholder={t('adminSmsPackages.topUp.note')} value={note} onChange={(e) => setNote(e.target.value)} className="border px-3 py-2 text-sm" style={inputStyle} />
      </div>
      {message && <p className="text-xs" style={{ color: isError ? 'var(--color-danger)' : 'var(--color-success)' }}>{message}</p>}
      <button type="submit" disabled={submitting} className="px-4 py-2 text-sm font-medium" style={{ borderRadius: 'var(--radius-button)', backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>
        {submitting ? t('adminSmsPackages.topUp.submitting') : t('adminSmsPackages.topUp.submit')}
      </button>
    </form>
  );
}

export default function SmsPackagesPage() {
  const locale = useLocale();
  const t = useT();
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, error, forbidden } = useBff<{ items: SmsPackage[] }>('admin/sms-packages', null, refreshKey);
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
      setFormError(err instanceof BffError ? err.message : t('adminSmsPackages.form.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  if (forbidden) return <EmptyState title={t('adminSmsPackages.accessDenied')} />;

  return (
    <div className="space-y-6" key={refreshKey}>
      <div>
        <h2 className="text-xl font-bold">{t('adminSmsPackages.title')}</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          {t('adminSmsPackages.subtitle')}
        </p>
      </div>

      <TopUpForm />

      <form onSubmit={submit} className="p-5 border space-y-3" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <h3 className="text-sm font-semibold">{t('adminSmsPackages.form.title')}</h3>
        <div className="grid grid-cols-4 gap-3">
          <input required placeholder={t('adminSmsPackages.form.key')} value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle} />
          <input required placeholder={t('adminSmsPackages.form.name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle} />
          <input required type="number" placeholder={t('adminSmsPackages.form.credits')} value={form.credits} onChange={(e) => setForm({ ...form, credits: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle} />
          <input required type="number" placeholder={t('adminSmsPackages.form.price')} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle} />
        </div>
        {formError && <p className="text-xs" style={{ color: 'var(--color-danger)' }}>{formError}</p>}
        <button type="submit" disabled={submitting} className="px-4 py-2 text-sm font-medium" style={{ borderRadius: 'var(--radius-button)', backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>
          {submitting ? t('adminSmsPackages.form.submitting') : t('adminSmsPackages.form.submit')}
        </button>
      </form>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && data && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {data.items.map((p) => (
            <div key={p.id} className="p-5 border" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
              <h3 className="text-sm font-semibold">{p.name}</h3>
              <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                {t('adminSmsPackages.cardSummary', { credits: p.credits.toLocaleString(locale), price: Number(p.price).toLocaleString(locale) })}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
