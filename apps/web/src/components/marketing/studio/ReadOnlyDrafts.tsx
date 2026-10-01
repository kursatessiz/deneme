'use client';

import { useState } from 'react';
import {
  MARKETING_MIN_CELL,
  ResearchNoteContentSchema,
  SegmentSuggestionContentSchema,
  type MarketingDraftDTO,
  type SegmentGroup,
} from '@platform/shared';
import { bffFetch } from '@/lib/session/client';
import { useT } from '@/components/i18n/I18nProvider';
import { InlineMessage, SecondaryButton } from '@/components/settings/ui';
import { marketingErrorText } from '@/lib/marketing/errors';
import { IssueList } from './VariantEditor';

/** Plain-text lines of a segment rule ("field op value"), nested groups indented. */
export function ruleLines(group: SegmentGroup, depth = 0): string[] {
  const pad = '  '.repeat(depth);
  const out: string[] = [];
  group.rules.forEach((rule, index) => {
    const prefix = index === 0 ? '' : `${group.combinator.toUpperCase()} `;
    if ('combinator' in rule) {
      out.push(`${pad}${prefix}(`);
      out.push(...ruleLines(rule, depth + 1));
      out.push(`${pad})`);
    } else {
      const value = rule.value === undefined ? '' : ` ${Array.isArray(rule.value) ? rule.value.join(', ') : String(rule.value)}`;
      out.push(`${pad}${prefix}${rule.field} ${rule.op}${value}`);
    }
  });
  return out;
}

/**
 * Segment suggestions are read-only proposals: rule, rationale and an
 * approximate size (hidden below k). Saving is the user's action and goes
 * through the existing segments API of the platform tenant.
 */
export function SegmentSuggestionView({ draft, platformStudioId, canSave }: { draft: MarketingDraftDTO; platformStudioId: string; canSave: boolean }) {
  const t = useT();
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(variantId: string, name: string, rules: SegmentGroup) {
    setBusy(true);
    setMessage(null);
    try {
      const segment = await bffFetch<{ id: string }>(`studios/${platformStudioId}/segments`, {
        method: 'POST',
        studioId: platformStudioId,
        body: { name, kind: 'DYNAMIC', rules },
      });
      setSaved({ ...saved, [variantId]: segment.id });
    } catch (err) {
      setMessage({ text: marketingErrorText(err, t), ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ui-divide">
      {draft.variants.map((variant) => {
        const parsed = SegmentSuggestionContentSchema.safeParse(variant.content);
        if (!parsed.success) return null;
        const content = parsed.data;
        return (
          <div key={variant.id} className="py-4 first:pt-0 space-y-2">
            <h4 className="ui-strong">
              {content.name}
            </h4>
            <p className="ui-text-muted">
              {content.rationale}
            </p>
            <pre className="ui-panel font-mono whitespace-pre-wrap p-3 ui-small">
              {ruleLines(content.rules).join('\n')}
            </pre>
            <p className="ui-caption">
              {content.approxCount === null ? t('marketingStudio.segments.sizeHidden', { k: MARKETING_MIN_CELL }) : t('marketingStudio.segments.size', { count: content.approxCount })}
            </p>
            <IssueList issues={variant.issues} />
            {canSave &&
              (saved[variant.id] ? (
                <InlineMessage text={t('marketingStudio.segments.saved')} tone="success" />
              ) : (
                <SecondaryButton disabled={busy} onClick={() => save(variant.id, content.name, content.rules)}>
                  {t('marketingStudio.segments.save')}
                </SecondaryButton>
              ))}
          </div>
        );
      })}
      {message && <InlineMessage text={message.text} tone={message.ok ? 'success' : 'error'} />}
    </div>
  );
}

/** A cited research note: the summary, then every point with its verbatim quote and source. */
export function ResearchNoteView({ draft }: { draft: MarketingDraftDTO }) {
  const t = useT();
  const variant = draft.variants[0];
  const parsed = variant ? ResearchNoteContentSchema.safeParse(variant.content) : null;
  if (!variant || !parsed || !parsed.success) return null;
  const note = parsed.data;
  const sources = new Map(note.sources.map((s) => [s.id, s]));
  return (
    <div className="space-y-3">
      <p className="ui-caption">
        {t('marketingStudio.research.mode')}
      </p>
      <p>
        {note.summary}
      </p>
      <ol className="space-y-3 list-decimal pl-5">
        {note.points.map((point, index) => {
          const source = sources.get(point.sourceId);
          return (
            <li key={index} className="space-y-1">
              <p>{point.claim}</p>
              <blockquote className="italic ui-rail ui-caption">
                {point.quote}
              </blockquote>
              <p className="ui-caption">
                {point.sourceId}: {source?.title}
                {source?.url ? (
                  <>
                    {' - '}
                    <a href={source.url} target="_blank" rel="noopener noreferrer" className="pui-link pui-surface">
                      {source.url}
                    </a>
                  </>
                ) : null}
              </p>
            </li>
          );
        })}
      </ol>
      <IssueList issues={variant.issues} />
    </div>
  );
}
