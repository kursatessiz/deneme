'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { AdminLanguageDTO } from '@platform/shared';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, ErrorState } from '@/components/common/DataState';
import { useT } from '@/components/i18n/I18nProvider';

const inputStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  borderColor: 'var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};

function CompletionBar({ completion }: { completion: number }) {
  const pct = Math.round(completion * 100);
  return (
    <div className="flex items-center gap-2 w-40">
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-surface-muted)' }}>
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, backgroundColor: pct === 100 ? 'var(--color-success, #12a150)' : 'var(--color-primary)' }}
        />
      </div>
      <span className="text-xs tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
        {pct}%
      </span>
    </div>
  );
}

export default function AdminI18nPage() {
  const t = useT();
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, error } = useBff<{ items: AdminLanguageDTO[] }>('admin/i18n/languages', null);
  const [form, setForm] = useState({ code: '', name: '', nativeName: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const refresh = () => setRefreshKey((k) => k + 1);

  async function createLanguage(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await bffFetch('admin/i18n/languages', { method: 'POST', body: form });
      setForm({ code: '', name: '', nativeName: '' });
      refresh();
    } catch (err) {
      setFormError(err instanceof BffError ? err.message : t('adminI18n.createError'));
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleEnabled(lang: AdminLanguageDTO) {
    await bffFetch(`admin/i18n/languages/${lang.code}`, { method: 'PUT', body: { isEnabled: !lang.isEnabled } }).catch(() => undefined);
    refresh();
  }

  async function deleteLanguage(code: string) {
    await bffFetch(`admin/i18n/languages/${code}`, { method: 'DELETE' }).catch(() => undefined);
    setPendingDelete(null);
    refresh();
  }

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;

  const items = data?.items ?? [];

  return (
    <div className="space-y-6" key={refreshKey}>
      <div>
        <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {t('adminI18n.title')}
        </h2>
        <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
          {t('adminI18n.subtitle')}
        </p>
      </div>

      <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface-muted)' }}>
              <th className="px-4 py-2 font-medium">{t('adminI18n.code')}</th>
              <th className="px-4 py-2 font-medium">{t('adminI18n.name')}</th>
              <th className="px-4 py-2 font-medium">{t('adminI18n.completion')}</th>
              <th className="px-4 py-2 font-medium">{t('adminI18n.enabled')}</th>
              <th className="px-4 py-2 font-medium text-right">{t('adminI18n.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((lang) => (
              <tr key={lang.code} className="border-b last:border-0" style={{ borderColor: 'var(--color-border)' }}>
                <td className="px-4 py-2 font-mono text-xs">{lang.code}</td>
                <td className="px-4 py-2">
                  <Link href={`/admin/i18n/${lang.code}`} className="font-medium hover:underline" style={{ color: 'var(--color-primary)' }}>
                    {lang.name}
                  </Link>
                  <span className="ml-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    ({lang.nativeName})
                  </span>
                </td>
                <td className="px-4 py-2">
                  <CompletionBar completion={lang.completion} />
                </td>
                <td className="px-4 py-2">
                  <span
                    className="text-xs font-medium px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: lang.isEnabled ? 'var(--color-success-bg, #e7f8ee)' : 'var(--color-surface-muted)',
                      color: lang.isEnabled ? 'var(--color-success, #12a150)' : 'var(--color-text-muted)',
                    }}
                  >
                    {lang.isEnabled ? t('adminI18n.enabled') : t('adminI18n.disabled')}
                  </span>
                </td>
                <td className="px-4 py-2 text-right space-x-2">
                  <Link href={`/admin/i18n/${lang.code}`} className="text-xs font-medium hover:underline" style={{ color: 'var(--color-primary)' }}>
                    {t('adminI18n.open')}
                  </Link>
                  <button
                    onClick={() => toggleEnabled(lang)}
                    disabled={lang.isBase && lang.isEnabled}
                    className="text-xs font-medium hover:underline disabled:opacity-40"
                    style={{ color: 'var(--color-text-secondary)' }}
                    title={lang.isBase ? t('adminI18n.cannotDisableBase') : undefined}
                  >
                    {lang.isEnabled ? t('adminI18n.disable') : t('adminI18n.enable')}
                  </button>
                  {!lang.isBundled &&
                    (pendingDelete === lang.code ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-xs" style={{ color: 'var(--color-danger, #b42318)' }}>
                          {t('adminI18n.deleteConfirmMessage', { name: lang.name })}
                        </span>
                        <button onClick={() => deleteLanguage(lang.code)} className="text-xs font-semibold" style={{ color: 'var(--color-danger, #b42318)' }}>
                          {t('adminI18n.deleteConfirm')}
                        </button>
                        <button onClick={() => setPendingDelete(null)} className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                          {t('common.cancel')}
                        </button>
                      </span>
                    ) : (
                      <button onClick={() => setPendingDelete(lang.code)} className="text-xs font-medium hover:underline" style={{ color: 'var(--color-danger, #b42318)' }}>
                        {t('adminI18n.delete')}
                      </button>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl border p-5 max-w-lg" style={{ borderColor: 'var(--color-border)' }}>
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text-primary)' }}>
          {t('adminI18n.addLanguage')}
        </h3>
        <form onSubmit={createLanguage} className="grid grid-cols-3 gap-3">
          <input
            required
            placeholder={t('adminI18n.code')}
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.trim() })}
            className="px-2 py-1.5 border text-sm"
            style={inputStyle}
          />
          <input
            required
            placeholder={t('adminI18n.name')}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="px-2 py-1.5 border text-sm"
            style={inputStyle}
          />
          <input
            required
            placeholder={t('adminI18n.nativeName')}
            value={form.nativeName}
            onChange={(e) => setForm({ ...form, nativeName: e.target.value })}
            className="px-2 py-1.5 border text-sm"
            style={inputStyle}
          />
          <button
            type="submit"
            disabled={submitting}
            className="col-span-3 px-3 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-60"
            style={{ backgroundColor: 'var(--color-primary)', borderRadius: 'var(--radius-button)' }}
          >
            {t('adminI18n.addLanguage')}
          </button>
        </form>
        {formError && (
          <p className="text-xs mt-2" style={{ color: 'var(--color-danger, #b42318)' }}>
            {formError}
          </p>
        )}
      </div>
    </div>
  );
}
