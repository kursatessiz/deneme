'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  MARKETING_DRAFT_KINDS,
  type BrandKitDTO,
  isAiErrorCode,
  MARKETING_DRAFT_STATUSES,
  type GenerateDraftsResultDTO,
  type MarketingAiStatusDTO,
  type MarketingDraftDTO,
  type MarketingDraftListDTO,
} from '@platform/shared';
import { bffFetch, BffError } from '@/lib/session/client';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/DataState';
import { InlineMessage, SecondaryButton, SettingsHeader } from '@/components/settings/ui';
import { marketingErrorText } from '@/lib/marketing/errors';
import { SelectField } from '../fields';
import { DraftCard } from './DraftCard';
import { GenerateForm } from './GenerateForm';
import { ResearchPanel, SegmentSuggestions } from './AnalysisPanels';
import { Button } from '@/components/ui/Button';

type Tab = 'generate' | 'drafts' | 'segments' | 'research';
const TABS: readonly Tab[] = ['generate', 'drafts', 'segments', 'research'];

/** Drafts list with kind and status filters; archived drafts appear only when asked for. */
function DraftsPanel() {
  const t = useT();
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<MarketingDraftListDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = new URLSearchParams({ page: String(page), limit: '10' });
    if (kind) query.set('kind', kind);
    if (status) query.set('status', status);
    let cancelled = false;
    bffFetch<MarketingDraftListDTO>(`platform/marketing/studio/drafts?${query.toString()}`)
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setError(null);
        }
      })
      .catch((err) => !cancelled && setError(marketingErrorText(err, t)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, status, page]);

  if (error) return <ErrorState message={error} />;
  if (!data) return <LoadingState />;
  const pages = Math.max(1, Math.ceil(data.total / data.limit));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <SelectField
            label={t('marketingStudio.drafts.kind')}
            value={kind}
            onChange={(v) => {
              setKind(v);
              setPage(1);
            }}
            options={[{ value: '', label: t('marketingStudio.drafts.all') }, ...MARKETING_DRAFT_KINDS.map((k) => ({ value: k, label: t(`marketingStudio.kind.${k}`) }))]}
          />
        </div>
        <div className="w-56">
          <SelectField
            label={t('marketingStudio.drafts.status')}
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            options={[{ value: '', label: t('marketingStudio.drafts.active') }, ...MARKETING_DRAFT_STATUSES.map((s) => ({ value: s, label: t(`marketingStudio.status.${s}`) }))]}
          />
        </div>
      </div>
      {data.items.length === 0 ? (
        <EmptyState title={t('marketingStudio.drafts.empty')} />
      ) : (
        data.items.map((draft) => (
          <DraftCard key={draft.id} draft={draft} onChange={(next) => setData({ ...data, items: data.items.map((d) => (d.id === next.id ? next : d)) })} />
        ))
      )}
      {pages > 1 && (
        <div className="flex items-center gap-3">
          <SecondaryButton disabled={page <= 1} onClick={() => setPage(page - 1)}>
            {t('marketingStudio.drafts.prev')}
          </SecondaryButton>
          <span className="ui-caption">
            {t('marketingStudio.drafts.page', { page, pages })}
          </span>
          <SecondaryButton disabled={page >= pages} onClick={() => setPage(page + 1)}>
            {t('marketingStudio.drafts.next')}
          </SecondaryButton>
        </div>
      )}
    </div>
  );
}

/**
 * AI studio (/pazarlama/yapay-zeka, docs/PAZARLAMA_MODULU.md 4.3): brief to
 * drafts, saved drafts, segment suggestions and cited research notes. It
 * needs the brand kit (the studio only writes within it), shows the month's
 * marketing AI budget and never sends or publishes anything.
 */
export function AiStudio() {
  const t = useT();
  const locale = useLocale();
  const [tab, setTab] = useState<Tab>('generate');
  const [kit, setKit] = useState<{ kit: BrandKitDTO | null } | null>(null);
  const [status, setStatus] = useState<MarketingAiStatusDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<GenerateDraftsResultDTO | null>(null);
  const [drafts, setDrafts] = useState<MarketingDraftDTO[]>([]);

  const loadStatus = useCallback(() => {
    bffFetch<MarketingAiStatusDTO>('platform/marketing/studio/status')
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    Promise.all([bffFetch<{ kit: BrandKitDTO | null }>('platform/marketing/studio/kit'), bffFetch<MarketingAiStatusDTO>('platform/marketing/studio/status')])
      .then(([k, s]) => {
        setKit(k);
        setStatus(s);
      })
      .catch((err) => setError(err instanceof BffError ? err.message : t('marketingStudio.loadFailed')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!kit || !status) return <LoadingState />;

  const usd = (cents: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(cents / 100);
  const usedCents = Math.ceil(status.usedMicroUsd / 10_000);
  const blocked = !status.configured || status.limitReached;

  return (
    <div className="space-y-6">
      <SettingsHeader title={t('marketingStudio.title')} description={t('marketingStudio.subtitle')} />
      <p className="ui-caption">
        {t('marketingStudio.budget', { used: usd(usedCents), budget: usd(status.budgetCents) })}
      </p>
      {!status.configured && <InlineMessage text={t('ai.error.AI_NOT_CONFIGURED')} tone="error" />}
      {status.limitReached && <InlineMessage text={t('ai.error.MARKETING_AI_BUDGET_EXCEEDED')} tone="error" />}

      {!kit.kit ? (
        <EmptyState
          title={t('marketingStudio.noKit.title')}
          description={t('marketingStudio.noKit.description')}
        />
      ) : (
        <>
          <div role="tablist" aria-label={t('marketingStudio.title')} className="ui-tabs flex-wrap pb-2">
            {TABS.map((id) => (
              <Button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                variant={tab === id ? 'solid' : 'link'}
                tone={tab === id ? 'theme' : 'surface'}
                size="sm"
              >
                {t(`marketingStudio.tab.${id}`)}
              </Button>
            ))}
            <Link href="/pazarlama/marka" className="ml-auto pui-link pui-surface ui-caption">
              {t('marketingStudio.editBrandKit')}
            </Link>
          </div>

          {tab === 'generate' && (
            <div className="space-y-6">
              <GenerateForm
                kit={kit.kit}
                disabled={blocked}
                onGenerated={(res) => {
                  setResults(res);
                  setDrafts([...res.drafts, ...drafts]);
                  loadStatus();
                }}
              />
              {results && results.failures.length > 0 && (
                <ul className="space-y-1">
                  {results.failures.map((f, i) => (
                    <li key={i}>
                      <InlineMessage
                        tone="error"
                        text={t('marketingStudio.generate.failure', { kind: t(`marketingStudio.kind.${f.kind}`), locale: f.locale, reason: t(`ai.error.${isAiErrorCode(f.code) ? f.code : 'AI_INVALID_OUTPUT'}`) })}
                      />
                    </li>
                  ))}
                </ul>
              )}
              {drafts.map((draft) => (
                <DraftCard key={draft.id} draft={draft} onChange={(next) => setDrafts(drafts.map((d) => (d.id === next.id ? next : d)))} />
              ))}
            </div>
          )}
          {tab === 'drafts' && <DraftsPanel />}
          {tab === 'segments' && <SegmentSuggestions kit={kit.kit} disabled={blocked} />}
          {tab === 'research' && <ResearchPanel kit={kit.kit} disabled={blocked} />}
        </>
      )}
    </div>
  );
}
