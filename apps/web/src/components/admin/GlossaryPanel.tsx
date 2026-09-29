'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GlossaryTermDTO } from '@platform/shared';
import { useT } from '@/components/i18n/I18nProvider';
import { bffFetch, BffError } from '@/lib/session/client';

const inputStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};

/** Per-language glossary sent with every AI translation request (G3b). */
export function GlossaryPanel({ code }: { code: string }) {
  const t = useT();
  const [items, setItems] = useState<GlossaryTermDTO[]>([]);
  const [term, setTerm] = useState('');
  const [translation, setTranslation] = useState('');
  const [keep, setKeep] = useState(true);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const base = `admin/i18n/languages/${encodeURIComponent(code)}/glossary`;

  const load = useCallback(() => {
    bffFetch<{ items: GlossaryTermDTO[] }>(base)
      .then((res) => setItems(res.items))
      .catch(() => setItems([]));
  }, [base]);
  useEffect(load, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await bffFetch(base, {
        method: 'POST',
        body: { term: term.trim(), translation: keep ? null : translation.trim(), note: note.trim() || null },
      });
      setTerm('');
      setTranslation('');
      setNote('');
      load();
    } catch (err) {
      setError(err instanceof BffError ? err.message : t('adminI18n.glossary.error'));
    }
  }

  async function remove(id: string) {
    await bffFetch(`${base}/${id}`, { method: 'DELETE' }).catch(() => undefined);
    load();
  }

  return (
    <section aria-labelledby="glossary-title" className="p-5 space-y-3 border" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)' }}>
      <h3 id="glossary-title" className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
        {t('adminI18n.glossary.title')}
      </h3>
      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        {t('adminI18n.glossary.hint')}
      </p>
      {items.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {t('adminI18n.glossary.empty')}
        </p>
      ) : (
        <ul className="text-sm divide-y" style={{ borderColor: 'var(--color-border)' }}>
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2 py-1.5">
              <span>
                <span className="font-medium">{item.term}</span>
                <span style={{ color: 'var(--color-text-secondary)' }}> {'->'} {item.translation ?? t('adminI18n.glossary.keep')}</span>
                {item.note && <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{` (${item.note})`}</span>}
              </span>
              <button type="button" onClick={() => remove(item.id)} className="text-xs underline" style={{ color: 'var(--color-text-muted)' }}>
                {t('adminI18n.glossary.delete')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
        <label className="block space-y-1" htmlFor="glossary-term">
          <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            {t('adminI18n.glossary.term')}
          </span>
          <input id="glossary-term" value={term} onChange={(e) => setTerm(e.target.value)} maxLength={120} className="w-full text-sm px-2 py-1.5" style={inputStyle} />
        </label>
        <label className="block space-y-1" htmlFor="glossary-translation">
          <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            {t('adminI18n.glossary.translation')}
          </span>
          <input
            id="glossary-translation"
            value={keep ? '' : translation}
            disabled={keep}
            onChange={(e) => setTranslation(e.target.value)}
            maxLength={200}
            className="w-full text-sm px-2 py-1.5 disabled:opacity-50"
            style={inputStyle}
          />
        </label>
        <label className="block space-y-1" htmlFor="glossary-note">
          <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            {t('adminI18n.glossary.note')}
          </span>
          <input id="glossary-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className="w-full text-sm px-2 py-1.5" style={inputStyle} />
        </label>
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
            {t('adminI18n.glossary.keep')}
          </label>
          <button
            type="submit"
            disabled={!term.trim() || (!keep && !translation.trim())}
            className="px-3 py-1.5 text-xs font-medium disabled:opacity-40"
            style={{ borderRadius: 'var(--radius-button)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
          >
            {t('adminI18n.glossary.add')}
          </button>
        </div>
      </form>
      {error && (
        <p className="text-xs" role="alert" style={{ color: 'var(--color-danger, #b42318)' }}>
          {error}
        </p>
      )}
    </section>
  );
}
