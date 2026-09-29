'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { ContactDTO, ContactListResponseDTO, PipelineStageDTO } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { PageGuard } from '@/components/common/PageGuard';
import { ErrorState, LoadingState } from '@/components/common/DataState';
import { bffFetch } from '@/lib/session/client';
import { hasAnyPermission } from '@/lib/nav';
import { Muted, Notice, PageHeader, inputStyle, errorMessage } from '@/components/growth/ui';
import { stageLabel } from '@/components/growth/crm-labels';
import { useAreaHref } from '@/components/session/AreaBase';

function PipelineBoard() {
  const { activeStudioId, permissions, isOwner } = useDashboardSession();
  const t = useT();
  const areaHref = useAreaHref();
  const canManage = hasAnyPermission(['crm.manage'], permissions, isOwner);
  const [stages, setStages] = useState<PipelineStageDTO[] | null>(null);
  const [cards, setCards] = useState<Record<string, ContactDTO[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeStudioId) return;
    try {
      const list = await bffFetch<PipelineStageDTO[]>(`crm/studios/${activeStudioId}/pipeline-stages`, { studioId: activeStudioId });
      const entries = await Promise.all(
        list.map(async (s) => {
          const res = await bffFetch<ContactListResponseDTO>(`crm/studios/${activeStudioId}/contacts?stage=${encodeURIComponent(s.key)}&limit=100`, {
            studioId: activeStudioId,
          });
          return [s.key, res.items] as const;
        }),
      );
      setStages(list);
      setCards(Object.fromEntries(entries));
      setError(null);
    } catch (err) {
      setError(errorMessage(err, t('common.error.generic')));
    }
  }, [activeStudioId, t]);

  useEffect(() => {
    load();
  }, [load]);

  async function move(contact: ContactDTO, requestedKey: string) {
    // Only a known stage can be a target; the key comes from a DOM control.
    const target = stages?.find((s) => s.key === requestedKey);
    if (!target) return;
    const targetKey = target.key;
    const fromKey = contact.pipelineStage?.key;
    if (!fromKey || fromKey === targetKey) return;
    setMoveError(null);
    // Optimistic: move the card, roll back on error.
    const previous = cards;
    setCards((current) => ({
      ...current,
      [fromKey]: (current[fromKey] ?? []).filter((c) => c.id !== contact.id),
      [targetKey]: [{ ...contact, pipelineStage: target }, ...(current[targetKey] ?? [])],
    }));
    try {
      await bffFetch(`crm/studios/${activeStudioId}/contacts/${encodeURIComponent(contact.id)}`, { method: 'PATCH', studioId: activeStudioId, body: { pipelineStageKey: targetKey } });
    } catch (err) {
      setCards(previous);
      setMoveError(errorMessage(err, t('common.error.generic')));
    }
  }

  const findContact = (id: string) => Object.values(cards).flat().find((c) => c.id === id);

  if (error) return <ErrorState message={error} />;
  if (!stages) return <LoadingState />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('crm.pipeline.title')}
        subtitle={t('crm.pipeline.subtitle')}
        actions={
          <Link href={areaHref('/kisiler')} className="text-xs font-medium px-3 py-1.5" style={{ ...inputStyle, borderRadius: 'var(--radius-button)' }}>
            {t('crm.card.back')}
          </Link>
        }
      />
      {moveError && <Notice tone="error">{moveError}</Notice>}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {stages.map((stage) => {
          const items = cards[stage.key] ?? [];
          const label = stageLabel(stage, t);
          return (
            <section
              key={stage.id}
              aria-label={label}
              className="space-y-2 p-2 min-h-[120px]"
              style={{
                borderRadius: 'var(--radius-card)',
                border: `1px dashed ${over === stage.key ? 'var(--color-primary)' : 'transparent'}`,
              }}
              onDragOver={(e) => {
                if (!canManage || !dragging) return;
                e.preventDefault();
                setOver(stage.key);
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const contact = dragging ? findContact(dragging) : undefined;
                setDragging(null);
                if (contact) move(contact, stage.key);
              }}
            >
              <div className="flex items-center justify-between text-xs font-semibold px-1" style={{ color: 'var(--color-text-secondary)' }}>
                <span>{label}</span>
                <span>{items.length}</span>
              </div>
              {items.length === 0 && <Muted>{t('crm.pipeline.emptyColumn')}</Muted>}
              <ul className="space-y-2">
                {items.map((contact) => (
                  <li
                    key={contact.id}
                    draggable={canManage}
                    onDragStart={() => setDragging(contact.id)}
                    onDragEnd={() => setDragging(null)}
                    className="p-3 text-sm space-y-2"
                    style={{ borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', cursor: canManage ? 'grab' : 'default' }}
                  >
                    <Link href={areaHref(`/kisiler/${encodeURIComponent(contact.id)}`)} className="block font-medium hover:underline" style={{ color: 'var(--color-text-primary)' }}>
                      {contact.fullName}
                    </Link>
                    {contact.ownerName && <Muted>{contact.ownerName}</Muted>}
                    {canManage && (
                      <select
                        aria-label={t('crm.pipeline.moveTo', { name: contact.fullName })}
                        value={stage.key}
                        onChange={(e) => move(contact, e.target.value)}
                        className="w-full text-xs px-2 py-1"
                        style={inputStyle}
                      >
                        {stages.map((s) => (
                          <option key={s.id} value={s.key}>
                            {stageLabel(s, t)}
                          </option>
                        ))}
                      </select>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <PageGuard required={['crm.view']}>
      <PipelineBoard />
    </PageGuard>
  );
}
