'use client';

import { useEffect, useState } from 'react';
import {
  RESEARCH_MAX_SOURCES,
  RESEARCH_MAX_SOURCE_CHARS,
  type BrandKitDTO,
  type MarketingDraftDTO,
  type SegmentInsightDTO,
  type SegmentSuggestionResultDTO,
} from '@platform/shared';
import { bffFetch } from '@/lib/session/client';
import { useT } from '@/components/i18n/I18nProvider';
import { ErrorState, LoadingState } from '@/components/common/DataState';
import { InlineMessage, PrimaryButton, SecondaryButton, Section } from '@/components/settings/ui';
import { marketingErrorText } from '@/lib/marketing/errors';
import { AreaField, InputField, LinkButton, SelectField } from '../fields';
import { DraftCard } from './DraftCard';

/** Aggregate view of the CRM the model sees: only counts and labels, cells below k are never listed. */
function InsightTable({ insight }: { insight: SegmentInsightDTO }) {
  const t = useT();
  if (insight.totalContacts === null) {
    return <InlineMessage text={t('marketingStudio.segments.tooSmall', { k: insight.k })} />;
  }
  return (
    <div className="space-y-3">
      <p className="ui-caption">
        {t('marketingStudio.segments.insightNote', { k: insight.k, total: insight.totalContacts })}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
        {insight.dimensions.map((d) => (
          <div key={d.key}>
            <h4 className="mb-1 ui-strong ui-small">
              {t(`marketingStudio.segments.dimension.${d.key}`)}
            </h4>
            <ul className="space-y-0.5">
              {d.cells.map((c) => (
                <li key={c.label} className="flex justify-between gap-3">
                  <span>{c.label === 'unknown' ? t('marketingStudio.segments.unknown') : c.label}</span>
                  <span className="tabular-nums">{c.count}</span>
                </li>
              ))}
              {d.otherCount > 0 && (
                <li className="flex justify-between gap-3 ui-text-muted">
                  <span>{t('marketingStudio.segments.other')}</span>
                  <span className="tabular-nums">{d.otherCount}</span>
                </li>
              )}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Segment suggestions from k-anonymous aggregates (docs/PAZARLAMA_MODULU.md 4.3, item 3). */
export function SegmentSuggestions({ kit, disabled }: { kit: BrandKitDTO; disabled: boolean }) {
  const t = useT();
  const [insight, setInsight] = useState<SegmentInsightDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [goal, setGoal] = useState('');
  const [count, setCount] = useState('3');
  const [locale, setLocale] = useState(kit.defaultLocale);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [drafts, setDrafts] = useState<MarketingDraftDTO[]>([]);

  useEffect(() => {
    bffFetch<SegmentInsightDTO>('platform/marketing/studio/segment-insight')
      .then(setInsight)
      .catch((err) => setError(marketingErrorText(err, t)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function suggest() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await bffFetch<SegmentSuggestionResultDTO>('platform/marketing/studio/segment-suggestions', {
        method: 'POST',
        body: { goal: goal.trim(), count: Number(count), locale },
      });
      setInsight(res.insight);
      setDrafts([res.draft, ...drafts]);
    } catch (err) {
      setMessage({ text: marketingErrorText(err, t), ok: false });
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorState message={error} />;
  if (!insight) return <LoadingState />;
  return (
    <div className="space-y-6">
      <Section title={t('marketingStudio.segments.title')} description={t('marketingStudio.segments.hint')}>
        <InsightTable insight={insight} />
      </Section>
      <Section title={t('marketingStudio.segments.suggestTitle')}>
        <AreaField label={t('marketingStudio.segments.goal')} value={goal} onChange={setGoal} rows={2} />
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-40">
            <SelectField
              label={t('marketingStudio.segments.count')}
              value={count}
              onChange={setCount}
              options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))}
            />
          </div>
          <div className="w-40">
            <SelectField label={t('marketingStudio.segments.locale')} value={locale} onChange={setLocale} options={kit.locales.map((l) => ({ value: l.locale, label: l.locale }))} />
          </div>
          <PrimaryButton onClick={suggest} disabled={disabled || busy || goal.trim() === '' || insight.totalContacts === null}>
            {busy ? t('marketingStudio.generate.busy') : t('marketingStudio.segments.button')}
          </PrimaryButton>
        </div>
        {message && <InlineMessage text={message.text} tone={message.ok ? 'success' : 'error'} />}
      </Section>
      {drafts.map((draft) => (
        <DraftCard key={draft.id} draft={draft} onChange={(next) => setDrafts(drafts.map((d) => (d.id === next.id ? next : d)))} />
      ))}
    </div>
  );
}

interface SourceForm {
  title: string;
  url: string;
  text: string;
}

/**
 * Research assistant in "cited notes" mode: the AI core has no web search or
 * fetch capability, so the user pastes the sources and the model answers
 * only from them; every point quotes its source verbatim.
 */
export function ResearchPanel({ kit, disabled }: { kit: BrandKitDTO; disabled: boolean }) {
  const t = useT();
  const [question, setQuestion] = useState('');
  const [locale, setLocale] = useState(kit.defaultLocale);
  const [sources, setSources] = useState<SourceForm[]>([{ title: '', url: '', text: '' }]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [notes, setNotes] = useState<MarketingDraftDTO[]>([]);

  const usable = sources.filter((s) => s.title.trim() !== '' && s.text.trim() !== '');
  const setSource = (index: number, patch: Partial<SourceForm>) => setSources(sources.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  async function ask() {
    setBusy(true);
    setMessage(null);
    try {
      const note = await bffFetch<MarketingDraftDTO>('platform/marketing/studio/research', {
        method: 'POST',
        body: {
          question: question.trim(),
          locale,
          sources: usable.map((s) => ({ title: s.title.trim(), text: s.text.trim(), ...(s.url.trim() ? { url: s.url.trim() } : {}) })),
        },
      });
      setNotes([note, ...notes]);
    } catch (err) {
      setMessage({ text: marketingErrorText(err, t), ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Section title={t('marketingStudio.research.title')} description={t('marketingStudio.research.hint')}>
        <InputField label={t('marketingStudio.research.question')} value={question} onChange={setQuestion} />
        {sources.map((source, index) => (
          <div key={index} className="space-y-2 pt-3 ui-rule">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <InputField label={t('marketingStudio.research.sourceTitle', { n: index + 1 })} value={source.title} onChange={(v) => setSource(index, { title: v })} />
              <InputField label={t('marketingStudio.research.sourceUrl', { n: index + 1 })} value={source.url} onChange={(v) => setSource(index, { url: v })} placeholder="https://" />
            </div>
            <AreaField
              label={t('marketingStudio.research.sourceText', { n: index + 1 })}
              value={source.text}
              onChange={(v) => setSource(index, { text: v })}
              rows={5}
              hint={`${source.text.length} / ${RESEARCH_MAX_SOURCE_CHARS}`}
              invalid={source.text.length > RESEARCH_MAX_SOURCE_CHARS}
            />
            {sources.length > 1 && <LinkButton danger onClick={() => setSources(sources.filter((_, i) => i !== index))}>{t('marketingStudio.research.removeSource')}</LinkButton>}
          </div>
        ))}
        {sources.length < RESEARCH_MAX_SOURCES && (
          <SecondaryButton onClick={() => setSources([...sources, { title: '', url: '', text: '' }])}>{t('marketingStudio.research.addSource')}</SecondaryButton>
        )}
        <p className="ui-caption">
          {t('marketingStudio.generate.piiNote')}
        </p>
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-40">
            <SelectField label={t('marketingStudio.segments.locale')} value={locale} onChange={setLocale} options={kit.locales.map((l) => ({ value: l.locale, label: l.locale }))} />
          </div>
          <PrimaryButton onClick={ask} disabled={disabled || busy || question.trim() === '' || usable.length === 0}>
            {busy ? t('marketingStudio.generate.busy') : t('marketingStudio.research.button')}
          </PrimaryButton>
        </div>
        {message && <InlineMessage text={message.text} tone={message.ok ? 'success' : 'error'} />}
      </Section>
      {notes.map((note) => (
        <DraftCard key={note.id} draft={note} onChange={(next) => setNotes(notes.map((n) => (n.id === next.id ? next : n)))} />
      ))}
    </div>
  );
}
