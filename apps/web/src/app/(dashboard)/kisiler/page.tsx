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
import { PageHeader, errorMessage, useDateFormat } from '@/components/growth/ui';
import { stageLabel } from '@/components/growth/crm-labels';
import { useAreaHref } from '@/components/session/AreaBase';
import { Input, Select, Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui';
import { LinkButton } from '@/components/ui/LinkButton';
import { Button } from '@/components/ui/Button';

const PAGE_SIZE = 25;

function ContactList() {
  const { activeStudioId } = useDashboardSession();
  const t = useT();
  const areaHref = useAreaHref();
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
          <LinkButton variant="outline" tone="surface" size="sm" href={areaHref('/kisiler/satis-hatti')}>
            {t('crm.contacts.pipelineLink')}
          </LinkButton>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Input
          type="search"
          aria-label={t('crm.contacts.search')}
          placeholder={t('crm.contacts.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select aria-label={t('crm.contacts.filter.lifecycle')} value={lifecycle} onChange={(e) => { setLifecycle(e.target.value); setPage(1); }}>
          <option value="">{`${t('crm.contacts.filter.lifecycle')}: ${t('crm.contacts.filter.all')}`}</option>
          {LIFECYCLE_STAGES.map((s) => (
            <option key={s} value={s}>
              {t(`crm.lifecycle.${s}`)}
            </option>
          ))}
        </Select>
        <Select aria-label={t('crm.contacts.filter.stage')} value={stage} onChange={(e) => { setStage(e.target.value); setPage(1); }}>
          <option value="">{`${t('crm.contacts.filter.stage')}: ${t('crm.contacts.filter.all')}`}</option>
          {stages.map((s) => (
            <option key={s.id} value={s.key}>
              {stageLabel(s, t)}
            </option>
          ))}
        </Select>
        <Select aria-label={t('crm.contacts.filter.tag')} value={tag} onChange={(e) => { setTag(e.target.value); setPage(1); }}>
          <option value="">{`${t('crm.contacts.filter.tag')}: ${t('crm.contacts.filter.all')}`}</option>
          {tags.map((tg) => (
            <option key={tg.tag} value={tg.tag}>
              {`${tg.tag} (${tg.count})`}
            </option>
          ))}
        </Select>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && data && data.items.length === 0 && <EmptyState title={t('crm.contacts.empty')} />}

      {!loading && !error && data && data.items.length > 0 && (
        <>
          <div className="overflow-x-auto pui-card">
            <Table aria-label={t('crm.contacts.title')}>
              <Thead>
                <Tr>
                  <Th>{t('crm.contacts.col.name')}</Th>
                  <Th>{t('crm.contacts.col.phone')}</Th>
                  <Th>{t('crm.contacts.col.lifecycle')}</Th>
                  <Th>{t('crm.contacts.col.pipeline')}</Th>
                  <Th>{t('crm.contacts.col.tags')}</Th>
                  <Th>{t('crm.contacts.col.source')}</Th>
                  <Th>{t('crm.contacts.col.createdAt')}</Th>
                </Tr>
              </Thead>
              <Tbody>
                {data.items.map((c) => (
                  <Tr key={c.id}>
                    <Td>
                      <Link href={areaHref(`/kisiler/${encodeURIComponent(c.id)}`)} className="pui-link pui-surface ui-strong">
                        {c.fullName}
                      </Link>
                    </Td>
                    <Td className="ui-text-muted">
                      {c.phone ?? ''}
                    </Td>
                    <Td>
                      <Badge>{t(`crm.lifecycle.${c.lifecycleStage}`)}</Badge>
                    </Td>
                    <Td className="ui-text-muted">
                      {c.pipelineStage ? stageLabel(c.pipelineStage, t) : ''}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {c.tags.map((tg) => (
                          <Badge key={tg} tone="info">
                            {tg}
                          </Badge>
                        ))}
                      </div>
                    </Td>
                    <Td className="ui-caption">
                      {c.lastSource ?? c.firstSource ?? c.sourceChannel ?? ''}
                    </Td>
                    <Td className="ui-caption">
                      {fmt.date(c.createdAt)}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
          <div className="flex items-center justify-between ui-caption">
            <span>{t('crm.contacts.total', { count: data.total })}</span>
            <div className="flex gap-2">
              <Button variant="outline" tone="surface" size="sm" type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                {t('crm.contacts.prev')}
              </Button>
              <Button variant="outline" tone="surface" size="sm" type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                {t('crm.contacts.next')}
              </Button>
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
