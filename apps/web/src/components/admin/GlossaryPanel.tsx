'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GlossaryTermDTO } from '@platform/shared';
import { useT } from '@/components/i18n/I18nProvider';
import { bffFetch, BffError } from '@/lib/session/client';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { FieldGroup } from '@/components/ui/FieldGroup';
import { Input } from '@/components/ui/Input';
import { List, ListItem } from '@/components/ui/List';

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
    <Card as="section" aria-labelledby="glossary-title">
      <CardContent>
        <h3 id="glossary-title" className="ui-heading">
          {t('adminI18n.glossary.title')}
        </h3>
        <p className="ui-caption">{t('adminI18n.glossary.hint')}</p>
        {items.length === 0 ? (
          <p className="ui-caption">{t('adminI18n.glossary.empty')}</p>
        ) : (
          <List className="ui-divide">
            {items.map((item) => (
              <ListItem key={item.id} className="flex items-center justify-between gap-2">
                <span>
                  <span className="ui-strong">{item.term}</span>
                  <span className="ui-text-muted">
                    {' '}
                    {'->'} {item.translation ?? t('adminI18n.glossary.keep')}
                  </span>
                  {item.note && <span className="ui-caption">{` (${item.note})`}</span>}
                </span>
                <Button variant="link" tone="muted" size="sm" onClick={() => remove(item.id)}>
                  {t('adminI18n.glossary.delete')}
                </Button>
              </ListItem>
            ))}
          </List>
        )}
        <form onSubmit={add} className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
          <FieldGroup label={t('adminI18n.glossary.term')}>
            <Input id="glossary-term" value={term} onChange={(e) => setTerm(e.target.value)} maxLength={120} />
          </FieldGroup>
          <FieldGroup label={t('adminI18n.glossary.translation')}>
            <Input id="glossary-translation" value={keep ? '' : translation} disabled={keep} onChange={(e) => setTranslation(e.target.value)} maxLength={200} />
          </FieldGroup>
          <FieldGroup label={t('adminI18n.glossary.note')}>
            <Input id="glossary-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </FieldGroup>
          <div className="flex items-center gap-3">
            <Checkbox label={t('adminI18n.glossary.keep')} checked={keep} onChange={(e) => setKeep(e.target.checked)} />
            <Button type="submit" variant="outline" tone="surface" size="sm" disabled={!term.trim() || (!keep && !translation.trim())}>
              {t('adminI18n.glossary.add')}
            </Button>
          </div>
        </form>
        {error && (
          <p className="ui-caption ui-text-error" role="alert">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
