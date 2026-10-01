'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  AB_TEST_METRICS,
  CAMPAIGN_EXPORTABLE_KINDS,
  GENERATABLE_DRAFT_KINDS,
  calendarChannelForDraftKind,
  hasBlockingIssues,
  type ExportToCampaignResultDTO,
  type GeneratableDraftKind,
  type MarketingDraftDTO,
  type MarketingDraftStatus,
  type SegmentDTO,
} from '@platform/shared';
import { bffFetch } from '@/lib/session/client';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { Badge } from '@/components/common/Badge';
import { InlineMessage, PrimaryButton, SecondaryButton } from '@/components/settings/ui';
import { marketingErrorText } from '@/lib/marketing/errors';
import { CheckField, InputField, LinkButton, SelectField } from '../fields';
import { usePlatformSession } from '../PlatformSession';
import { ResearchNoteView, SegmentSuggestionView } from './ReadOnlyDrafts';
import { IssueList, VariantEditor } from './VariantEditor';

const STATUS_TONE: Record<MarketingDraftStatus, 'neutral' | 'success' | 'info'> = { DRAFT: 'neutral', REVIEWED: 'success', ARCHIVED: 'info' };

const isGeneratable = (kind: string): kind is GeneratableDraftKind => (GENERATABLE_DRAFT_KINDS as readonly string[]).includes(kind);
const AB_KINDS: readonly string[] = ['EMAIL', 'SMS', 'WHATSAPP', 'SUBJECT_LINES', 'CTA_VARIANTS'];

/**
 * One AI studio draft: its status, the editable variants with their brand
 * check issues, more variants, the A/B setup, the calendar shortcut and
 * "Kampanyaya aktar" (which carries the A/B setup into the campaign). Everything
 * here only changes the draft; the studio never sends or publishes, and an
 * export stops at a DRAFT campaign.
 */
export function DraftCard({ draft, onChange }: { draft: MarketingDraftDTO; onChange: (next: MarketingDraftDTO) => void }) {
  const t = useT();
  const locale = useLocale();
  const { platformStudioId, permissions, isSuperAdmin } = usePlatformSession();
  const canCampaign = isSuperAdmin || permissions.includes('platform.marketing.manage');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const locked = draft.status === 'ARCHIVED';

  async function run<T>(action: () => Promise<T>, done?: (result: T) => void, okText?: string) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await action();
      done?.(result);
      if (okText) setMessage({ text: okText, ok: true });
    } catch (err) {
      setMessage({ text: marketingErrorText(err, t), ok: false });
    } finally {
      setBusy(false);
    }
  }

  const setStatus = (status: MarketingDraftStatus) =>
    run(() => bffFetch<MarketingDraftDTO>(`platform/marketing/studio/drafts/${draft.id}`, { method: 'PATCH', body: { status } }), onChange);

  return (
    <article
      aria-label={draft.title}
      className="p-5 space-y-4 pui-card"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="info">{t(`marketingStudio.kind.${draft.kind}`)}</Badge>
            <Badge>{draft.locale}</Badge>
            <Badge tone={STATUS_TONE[draft.status]}>{t(`marketingStudio.status.${draft.status}`)}</Badge>
            {draft.exportedCampaignId && <Badge tone="success">{t('marketingStudio.exported')}</Badge>}
          </div>
          <h3 className="mt-2 break-words ui-strong">
            {draft.title}
          </h3>
          <p className="mt-0.5 ui-caption">
            {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(draft.createdAt))}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {draft.status === 'DRAFT' && <LinkButton onClick={() => setStatus('REVIEWED')} disabled={busy}>{t('marketingStudio.markReviewed')}</LinkButton>}
          {draft.status === 'REVIEWED' && <LinkButton onClick={() => setStatus('DRAFT')} disabled={busy}>{t('marketingStudio.backToDraft')}</LinkButton>}
          {draft.status !== 'ARCHIVED' ? (
            <LinkButton danger onClick={() => setStatus('ARCHIVED')} disabled={busy}>
              {t('marketingStudio.archive')}
            </LinkButton>
          ) : (
            <LinkButton onClick={() => setStatus('DRAFT')} disabled={busy}>
              {t('marketingStudio.restore')}
            </LinkButton>
          )}
        </div>
      </header>

      {draft.kind === 'SEGMENT_SUGGESTION' && <SegmentSuggestionView draft={draft} platformStudioId={platformStudioId} canSave={canCampaign} />}
      {draft.kind === 'RESEARCH_NOTE' && <ResearchNoteView draft={draft} />}

      {isGeneratable(draft.kind) && (
        <div className="ui-divide">
          {draft.variants.map((variant) => (
            <div key={`${variant.id}:${variant.editedAt}`} className="py-4 first:pt-0">
              <VariantEditor
                kind={draft.kind as GeneratableDraftKind}
                variant={variant}
                locked={locked}
                busy={busy}
                onSave={(content) =>
                  run(
                    () => bffFetch<MarketingDraftDTO>(`platform/marketing/studio/drafts/${draft.id}/variants/${variant.id}`, { method: 'PATCH', body: { content } }),
                    onChange,
                    t('marketingStudio.variantSaved', { key: variant.key }),
                  )
                }
              />
            </div>
          ))}
        </div>
      )}

      {isGeneratable(draft.kind) && !locked && draft.variants.length < 10 && (
        <div>
          <SecondaryButton
            disabled={busy}
            onClick={() =>
              run(() => bffFetch<MarketingDraftDTO>(`platform/marketing/studio/drafts/${draft.id}/variants`, { method: 'POST', body: { count: 2 } }), onChange, t('marketingStudio.variantsAdded'))
            }
          >
            {t('marketingStudio.moreVariants')}
          </SecondaryButton>
        </div>
      )}

      {isGeneratable(draft.kind) && AB_KINDS.includes(draft.kind) && draft.variants.length >= 2 && (
        <AbSetup draft={draft} locked={locked} busy={busy} run={run} onChange={onChange} />
      )}
      {isGeneratable(draft.kind) && !locked && canCampaign && <CalendarShortcut draft={draft} busy={busy} run={run} />}
      {(CAMPAIGN_EXPORTABLE_KINDS as readonly string[]).includes(draft.kind) && !locked && canCampaign && (
        <ExportPanel draft={draft} platformStudioId={platformStudioId} busy={busy} run={run} onChange={onChange} />
      )}

      {message && <InlineMessage text={message.text} tone={message.ok ? 'success' : 'error'} />}
    </article>
  );
}

type Run = <T>(action: () => Promise<T>, done?: (result: T) => void, okText?: string) => Promise<void>;

function AbSetup({ draft, locked, busy, run, onChange }: { draft: MarketingDraftDTO; locked: boolean; busy: boolean; run: Run; onChange: (d: MarketingDraftDTO) => void }) {
  const t = useT();
  const stored = draft.abTest;
  const [enabled, setEnabled] = useState(stored?.enabled ?? false);
  const [share, setShare] = useState(String(stored?.testSharePercent ?? 20));
  const [metric, setMetric] = useState<string>(stored?.metric ?? 'CLICK');
  const [wait, setWait] = useState(String(stored?.waitHours ?? 24));
  const [ids, setIds] = useState<string[]>(stored?.variantIds ?? draft.variants.slice(0, 2).map((v) => v.id));

  return (
    <fieldset className="space-y-3 pt-4 ui-rule">
      <legend className="ui-strong ui-small">
        {t('marketingStudio.ab.title')}
      </legend>
      <p className="ui-caption">
        {t('marketingStudio.ab.hint')}
      </p>
      <CheckField label={t('marketingStudio.ab.enabled')} checked={enabled} onChange={setEnabled} disabled={locked} />
      <div className="flex flex-wrap gap-4">
        {draft.variants.map((v) => (
          <CheckField
            key={v.id}
            label={t('marketingStudio.variant', { key: v.key })}
            checked={ids.includes(v.id)}
            onChange={(on) => setIds(on ? [...ids, v.id] : ids.filter((id) => id !== v.id))}
            disabled={locked}
          />
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <InputField label={t('marketingStudio.ab.share')} type="number" value={share} onChange={setShare} disabled={locked} />
        <SelectField
          label={t('marketingStudio.ab.metric')}
          value={metric}
          onChange={setMetric}
          options={AB_TEST_METRICS.map((m) => ({ value: m, label: t(`marketingStudio.ab.metric.${m}`) }))}
          disabled={locked}
        />
        <InputField label={t('marketingStudio.ab.wait')} type="number" value={wait} onChange={setWait} disabled={locked} />
      </div>
      {!locked && (
        <SecondaryButton
          disabled={busy || ids.length < 2}
          onClick={() =>
            run(
              () =>
                bffFetch<MarketingDraftDTO>(`platform/marketing/studio/drafts/${draft.id}/ab-test`, {
                  method: 'PUT',
                  body: { enabled, testSharePercent: Number(share), metric, waitHours: Number(wait), variantIds: ids },
                }),
              onChange,
              t('marketingStudio.ab.saved'),
            )
          }
        >
          {t('marketingStudio.ab.save')}
        </SecondaryButton>
      )}
    </fieldset>
  );
}

function CalendarShortcut({ draft, busy, run }: { draft: MarketingDraftDTO; busy: boolean; run: Run }) {
  const t = useT();
  const [date, setDate] = useState('');
  return (
    <div className="flex flex-wrap items-end gap-3 pt-4 ui-rule">
      <InputField label={t('marketingStudio.calendar.date')} type="date" value={date} onChange={setDate} />
      <SecondaryButton
        disabled={busy || date === ''}
        onClick={() =>
          run(
            () =>
              bffFetch('platform/marketing/calendar/items', {
                method: 'POST',
                body: { title: draft.title.slice(0, 160), channel: calendarChannelForDraftKind(draft.kind), scheduledDate: date, status: 'DRAFTED', draftId: draft.id },
              }),
            () => setDate(''),
            t('marketingStudio.calendar.added'),
          )
        }
      >
        {t('marketingStudio.calendar.add')}
      </SecondaryButton>
      <Link href="/pazarlama/takvim" className="pui-link pui-surface ui-caption">
        {t('marketingStudio.calendar.open')}
      </Link>
    </div>
  );
}

function ExportPanel({
  draft,
  platformStudioId,
  busy,
  run,
  onChange,
}: {
  draft: MarketingDraftDTO;
  platformStudioId: string;
  busy: boolean;
  run: Run;
  onChange: (d: MarketingDraftDTO) => void;
}) {
  const t = useT();
  const [segments, setSegments] = useState<SegmentDTO[]>([]);
  const [segmentId, setSegmentId] = useState('');
  const [variantId, setVariantId] = useState(draft.variants[0]?.id ?? '');
  const [name, setName] = useState('');
  const [result, setResult] = useState<ExportToCampaignResultDTO | null>(null);
  const abStored = draft.abTest?.enabled === true;
  const [withAb, setWithAb] = useState(true);

  useEffect(() => {
    bffFetch<{ items: SegmentDTO[] }>(`studios/${platformStudioId}/segments`, { studioId: platformStudioId })
      .then((res) => {
        setSegments(res.items);
        setSegmentId((current) => current || res.items[0]?.id || '');
      })
      .catch(() => setSegments([]));
  }, [platformStudioId]);

  const variant = draft.variants.find((v) => v.id === variantId);
  const blocked = variant ? hasBlockingIssues(variant.issues) : false;

  return (
    <fieldset className="space-y-3 pt-4 ui-rule">
      <legend className="ui-strong ui-small">
        {t('marketingStudio.export.title')}
      </legend>
      <p className="ui-caption">
        {t('marketingStudio.export.hint')}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <SelectField
          label={t('marketingStudio.export.variant')}
          value={variantId}
          onChange={setVariantId}
          options={draft.variants.map((v) => ({ value: v.id, label: t('marketingStudio.variant', { key: v.key }) }))}
        />
        <SelectField
          label={t('marketingStudio.export.segment')}
          value={segmentId}
          onChange={setSegmentId}
          options={segments.length === 0 ? [{ value: '', label: t('marketingStudio.export.noSegments') }] : segments.map((s) => ({ value: s.id, label: s.name }))}
        />
        <InputField label={t('marketingStudio.export.name')} value={name} onChange={setName} placeholder={draft.title.slice(0, 60)} />
      </div>
      {abStored && <CheckField label={t('marketingStudio.export.withAb')} checked={withAb} onChange={setWithAb} />}
      {blocked && <InlineMessage text={t('marketingStudio.export.blocked')} tone="error" />}
      {variant && !blocked && <IssueList issues={variant.issues} />}
      <PrimaryButton
        disabled={busy || segmentId === '' || variantId === '' || blocked}
        onClick={() =>
          run(
            async () => {
              const res = await bffFetch<ExportToCampaignResultDTO>(`platform/marketing/studio/drafts/${draft.id}/export-campaign`, {
                method: 'POST',
                body: { variantId, segmentId, ...(name.trim() ? { name: name.trim() } : {}), ...(abStored ? { withAbTest: withAb } : {}) },
              });
              onChange(await bffFetch<MarketingDraftDTO>(`platform/marketing/studio/drafts/${draft.id}`));
              return res;
            },
            setResult,
          )
        }
      >
        {t('marketingStudio.export.button')}
      </PrimaryButton>
      {(result || draft.exportedCampaignId) && (
        <p className="ui-caption">
          {t('marketingStudio.export.done')} {result?.abTest ? `${t('marketingStudio.export.doneAb')} ` : ''}
          <Link href={`/pazarlama/kampanyalar/${result?.campaignId ?? draft.exportedCampaignId}`} className="pui-link pui-surface">
            {t('marketingStudio.export.open')}
          </Link>
        </p>
      )}
    </fieldset>
  );
}
