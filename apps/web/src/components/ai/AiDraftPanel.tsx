'use client';

import { useEffect, useId, useState } from 'react';
import { AI_DRAFT_TONES, type AiDraftDTO, type AiDraftKind, type AiDraftTone, type PublicLanguagesDTO } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { PermissionButton } from '@/components/common/PermissionButton';
import { bffFetch } from '@/lib/session/client';
import { aiErrorText } from '@/lib/ai/errors';
import { Select, Textarea } from '@/components/ui';
import { Button } from '@/components/ui/Button';

interface Props {
  /** Text types offered; the first one is preselected. */
  kinds: readonly AiDraftKind[];
  /** Language of the draft; defaults to the viewer's language. */
  locale?: string;
  /** Shown under the result, e.g. where to paste a campaign draft. */
  hint?: string;
  /** "Use this text": fills the caller's field. Without it the panel offers copy only. */
  onUse?: (draft: AiDraftDTO) => void;
}

/**
 * "AI ile yaz": a brief, a text type, a tone and a language in, a plain-text
 * draft out (G3b). Only rendered for ai.use; the API also enforces it and
 * the tenant's monthly AI budget. The draft is never sent by itself.
 */
export function AiDraftPanel({ kinds, locale, hint, onUse }: Props) {
  const t = useT();
  const uiLocale = useLocale();
  const { activeStudioId } = useDashboardSession();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<AiDraftKind>(kinds[0]);
  const [tone, setTone] = useState<AiDraftTone>('FRIENDLY');
  const [draftLocale, setDraftLocale] = useState(locale ?? uiLocale);
  const [languages, setLanguages] = useState<string[]>([]);
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AiDraftDTO | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!kinds.includes(kind)) setKind(kinds[0]);
  }, [kinds, kind]);
  useEffect(() => {
    if (locale) setDraftLocale(locale);
  }, [locale]);
  useEffect(() => {
    if (!open || languages.length > 0) return;
    bffFetch<PublicLanguagesDTO>('i18n/languages')
      .then((res) => setLanguages(res.items.map((l) => l.code)))
      .catch(() => setLanguages([]));
  }, [open, languages.length]);

  async function generate() {
    if (!activeStudioId) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setCopied(false);
    try {
      setResult(
        await bffFetch<AiDraftDTO>(`studios/${activeStudioId}/ai/draft`, {
          method: 'POST',
          studioId: activeStudioId,
          body: { kind, brief: brief.trim(), locale: draftLocale, tone },
        }),
      );
    } catch (err) {
      setError(aiErrorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!result) return;
    const text = result.subject ? `${result.subject}\n\n${result.text}` : result.text;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (!open) {
    return (
      <PermissionButton required={['ai.use']} onClick={() => setOpen(true)}>
        {t('ai.write')}
      </PermissionButton>
    );
  }

  const localeOptions = languages.includes(draftLocale) ? languages : [draftLocale, ...languages];

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="p-4 space-y-3 pui-card"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id={`${id}-title`} className="ui-strong">
          {t('ai.draft.title')}
        </h3>
        <Button variant="link" tone="muted" size="sm" type="button" onClick={() => setOpen(false)}>
          {t('ai.draft.close')}
        </Button>
      </div>
      <label className="block space-y-1" htmlFor={`${id}-brief`}>
        <span className="ui-strong ui-caption">
          {t('ai.draft.brief')}
        </span>
        <Textarea
          id={`${id}-brief`}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder={t('ai.draft.briefPlaceholder')}
          rows={3}
          maxLength={1000}
        />
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {kinds.length > 1 && (
          <label className="block space-y-1" htmlFor={`${id}-kind`}>
            <span className="ui-strong ui-caption">
              {t('ai.draft.kind')}
            </span>
            <Select id={`${id}-kind`} value={kind} onChange={(e) => setKind(e.target.value as AiDraftKind)}>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {t(`ai.draft.kind.${k}`)}
                </option>
              ))}
            </Select>
          </label>
        )}
        <label className="block space-y-1" htmlFor={`${id}-tone`}>
          <span className="ui-strong ui-caption">
            {t('ai.draft.tone')}
          </span>
          <Select id={`${id}-tone`} value={tone} onChange={(e) => setTone(e.target.value as AiDraftTone)}>
            {AI_DRAFT_TONES.map((k) => (
              <option key={k} value={k}>
                {t(`ai.draft.tone.${k}`)}
              </option>
            ))}
          </Select>
        </label>
        <label className="block space-y-1" htmlFor={`${id}-locale`}>
          <span className="ui-strong ui-caption">
            {t('ai.draft.locale')}
          </span>
          <Select id={`${id}-locale`} value={draftLocale} onChange={(e) => setDraftLocale(e.target.value)}>
            {localeOptions.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <div className="flex items-center gap-2">
        <PermissionButton required={['ai.use']} variant="primary" onClick={generate} disabled={busy || brief.trim().length < 3}>
          {busy ? t('ai.draft.generating') : t('ai.draft.generate')}
        </PermissionButton>
      </div>
      {error && (
        <p className="ui-text-error ui-small" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div className="space-y-2" data-testid="ai-draft-result">
          <p className="ui-strong ui-caption">
            {t('ai.draft.result')}
          </p>
          {result.subject && (
            <p>
              <span className="ui-strong">{t('ai.draft.subject')}: </span>
              {result.subject}
            </p>
          )}
          <p className="ui-panel whitespace-pre-wrap p-3">
            {result.text}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {onUse && (
              <PermissionButton required={['ai.use']} onClick={() => onUse(result)}>
                {t('ai.draft.use')}
              </PermissionButton>
            )}
            <PermissionButton required={['ai.use']} onClick={copy}>
              {copied ? t('ai.draft.copied') : t('ai.draft.copy')}
            </PermissionButton>
          </div>
          <p className="ui-caption">
            {hint ?? t('ai.draft.hint')}
          </p>
        </div>
      )}
    </section>
  );
}
