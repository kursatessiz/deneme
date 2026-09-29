'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { LIFECYCLE_STAGES } from '@platform/shared';
import type { ContactListResponseDTO, PipelineStageDTO } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { PageGuard } from '@/components/common/PageGuard';
import { Badge } from '@/components/common/Badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/DataState';
import { bffFetch } from '@/lib/session/client';
import { PageHeader, inputClass, inputStyle, errorMessage, useDateFormat } from '@/components/growth/ui';
import { stageLabel } from '@/components/growth/crm-labels';

const PAGE_SIZE = 25;

function ContactList() {
  const { activeStudioId } = useDashboardSession();
  const t = useT();
  const fmt = useDateFormat();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [lifecycle, setLifecycle] = useState('');
  const [stage, setStage] = useState('');
  const [tag, setTag] = useState('');
  const [page, setPage] = useState(1);
  const [stages, setStages] = useState<PipelineStageDTO[]>([]);
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [data, setData] = useState<ContactListResponseDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeStudioId) return;
    bffFetch<PipelineStageDTO[]>(`crm/studios/${activeStudioId}/pipeline-stages`, { studioId: activeStudioId })
      .then(setStages)
      .catch(() => setStages([]));
    bffFetch<{ tag: string; count: number }[]>(`crm/studios/${activeStudioId}/tags`, { studioId: activeStudioId })
      .then(setTags)
      .catch(() => setTags([]));
  }, [activeStudioId]);

  // Search waits for a short pause in typing.
  useEffect(() => {
    const id = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => {
    if (!activeStudioId) return;
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (query) params.set('search', query);
    if (lifecycle) params.set('lifecycleStage', lifecycle);
    if (stage) params.set('stage', stage);
    if (tag) params.set('tag', tag);
    setLoading(true);
    setError(null);
    bffFetch<ContactListResponseDTO>(`crm/studios/${activeStudioId}/contacts?${params.toString()}`, { studioId: activeStudioId })
      .then(setData)
      .catch((err) => setError(errorMessage(err, t('common.error.generic'))))
      .finally(() => setLoading(false));
  }, [activeStudioId, page, query, lifecycle, stage, tag, t]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('crm.contacts.title')}
        subtitle={t('crm.contacts.subtitle')}
        actions={
          <Link href="/kisiler/satis-hatti" className="text-xs font-medium px-3 py-1.5" style={{ ...inputStyle, borderRadius: 'var(--radius-button)' }}>
            {t('crm.contacts.pipelineLink')}
          </Link>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <input
          type="search"
          aria-label={t('crm.contacts.search')}
          placeholder={t('crm.contacts.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={inputClass}
          style={inputStyle}
        />
        <select aria-label={t('crm.contacts.filter.lifecycle')} value={lifecycle} onChange={(e) => { setLifecycle(e.target.value); setPage(1); }} className={inputClass} style={inputStyle}>
          <option value="">{`${t('crm.contacts.filter.lifecycle')}: ${t('crm.contacts.filter.all')}`}</option>
          {LIFECYCLE_STAGES.map((s) => (
            <option key={s} value={s}>
              {t(`crm.lifecycle.${s}`)}
            </option>
          ))}
        </select>
        <select aria-label={t('crm.contacts.filter.stage')} value={stage} onChange={(e) => { setStage(e.target.value); setPage(1); }} className={inputClass} style={inputStyle}>
          <option value="">{`${t('crm.contacts.filter.stage')}: ${t('crm.contacts.filter.all')}`}</option>
          {stages.map((s) => (
            <option key={s.id} value={s.key}>
              {stageLabel(s, t)}
            </option>
          ))}
        </select>
        <select aria-label={t('crm.contacts.filter.tag')} value={tag} onChange={(e) => { setTag(e.target.value); setPage(1); }} className={inputClass} style={inputStyle}>
          <option value="">{`${t('crm.contacts.filter.tag')}: ${t('crm.contacts.filter.all')}`}</option>
          {tags.map((tg) => (
            <option key={tg.tag} value={tg.tag}>
              {`${tg.tag} (${tg.count})`}
            </option>
          ))}
        </select>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && data && data.items.length === 0 && <EmptyState title={t('crm.contacts.empty')} />}

      {!loading && !error && data && data.items.length > 0 && (
        <>
          <div className="overflow-x-auto" style={{ borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            <table className="w-full text-sm" aria-label={t('crm.contacts.title')}>
              <thead>
                <tr className="text-left text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  <th className="px-4 py-2 font-medium">{t('crm.contacts.col.name')}</th>
                  <th className="px-4 py-2 font-medium">{t('crm.contacts.col.phone')}</th>
                  <th className="px-4 py-2 font-medium">{t('crm.contacts.col.lifecycle')}</th>
                  <th className="px-4 py-2 font-medium">{t('crm.contacts.col.pipeline')}</th>
                  <th className="px-4 py-2 font-medium">{t('crm.contacts.col.tags')}</th>
                  <th className="px-4 py-2 font-medium">{t('crm.contacts.col.source')}</th>
                  <th className="px-4 py-2 font-medium">{t('crm.contacts.col.createdAt')}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((c) => (
                  <tr key={c.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                    <td className="px-4 py-2.5">
                      <Link href={`/kisiler/${c.id}`} className="font-medium hover:underline" style={{ color: 'var(--color-text-primary)' }}>
                        {c.fullName}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5" style={{ color: 'var(--color-text-secondary)' }}>
                      {c.phone ?? ''}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge>{t(`crm.lifecycle.${c.lifecycleStage}`)}</Badge>
                    </td>
                    <td className="px-4 py-2.5" style={{ color: 'var(--color-text-secondary)' }}>
                      {c.pipelineStage ? stageLabel(c.pipelineStage, t) : ''}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {c.tags.map((tg) => (
                          <Badge key={tg} tone="info">
                            {tg}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                      {c.lastSource ?? c.firstSource ?? c.sourceChannel ?? ''}
                    </td>
                    <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {fmt.date(c.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            <span>{t('crm.contacts.total', { count: data.total })}</span>
            <div className="flex gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1.5 disabled:opacity-50" style={{ ...inputStyle, borderRadius: 'var(--radius-button)' }}>
                {t('crm.contacts.prev')}
              </button>
              <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 disabled:opacity-50" style={{ ...inputStyle, borderRadius: 'var(--radius-button)' }}>
                {t('crm.contacts.next')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <PageGuard required={['crm.view']}>
      <ContactList />
    </PageGuard>
  );
}
