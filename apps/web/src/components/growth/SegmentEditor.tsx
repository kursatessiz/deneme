'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { SegmentContactsDTO, SegmentDTO, SegmentFieldCatalogueDTO, SegmentGroup, SegmentKind } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { PermissionButton } from '@/components/common/PermissionButton';
import { LoadingState, ErrorState } from '@/components/common/DataState';
import { bffFetch } from '@/lib/session/client';
import { hasAnyPermission } from '@/lib/nav';
import { EMPTY_RULES, SegmentBuilder, SegmentPreview } from './SegmentBuilder';
import { Field, Muted, Notice, PageHeader, Panel, inputClass, inputStyle, errorMessage, useDateFormat } from './ui';

/** Create (segment undefined) or edit a segment: rule builder, live preview, members of a static segment. */
export function SegmentEditor({ segmentId }: { segmentId?: string }) {
  const { activeStudioId, permissions, isOwner } = useDashboardSession();
  const t = useT();
  const router = useRouter();
  const fmt = useDateFormat();
  const canManage = hasAnyPermission(['segments.manage'], permissions, isOwner);
  const [catalogue, setCatalogue] = useState<SegmentFieldCatalogueDTO | null>(null);
  const [segment, setSegment] = useState<SegmentDTO | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<SegmentKind>('DYNAMIC');
  const [seedFromRules, setSeedFromRules] = useState(false);
  const [rules, setRules] = useState<SegmentGroup>(EMPTY_RULES);
  const [members, setMembers] = useState<SegmentContactsDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!activeStudioId) return;
    bffFetch<SegmentFieldCatalogueDTO>(`studios/${activeStudioId}/segments/fields`, { studioId: activeStudioId })
      .then(setCatalogue)
      .catch((err) => setError(errorMessage(err, t('common.error.generic'))));
    if (!segmentId) return;
    bffFetch<SegmentDTO>(`studios/${activeStudioId}/segments/${segmentId}`, { studioId: activeStudioId })
      .then((s) => {
        setSegment(s);
        setName(s.name);
        setDescription(s.description ?? '');
        setKind(s.kind);
        if (s.rules) setRules(s.rules);
      })
      .catch((err) => setError(errorMessage(err, t('common.error.generic'))));
    bffFetch<SegmentContactsDTO>(`studios/${activeStudioId}/segments/${segmentId}/contacts?limit=50`, { studioId: activeStudioId })
      .then(setMembers)
      .catch(() => setMembers(null));
  }, [activeStudioId, segmentId, t]);

  async function save() {
    setBusy(true);
    setNotice(null);
    try {
      if (segment) {
        const updated = await bffFetch<SegmentDTO>(`studios/${activeStudioId}/segments/${segment.id}`, {
          method: 'PATCH',
          studioId: activeStudioId,
          body: { name, description: description || null, ...(segment.kind === 'DYNAMIC' ? { rules } : {}) },
        });
        setSegment(updated);
        setNotice({ tone: 'success', text: t('segments.saved') });
      } else {
        const created = await bffFetch<SegmentDTO>(`studios/${activeStudioId}/segments`, {
          method: 'POST',
          studioId: activeStudioId,
          body: {
            name,
            ...(description ? { description } : {}),
            kind,
            ...(kind === 'DYNAMIC' || seedFromRules ? { rules } : {}),
            ...(kind === 'STATIC' && seedFromRules ? { seedFromRules: true } : {}),
          },
        });
        router.push(`/segmentler/${created.id}`);
      }
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, t('common.error.generic')) });
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    if (!segment) return;
    try {
      setSegment(await bffFetch<SegmentDTO>(`studios/${activeStudioId}/segments/${segment.id}/refresh`, { method: 'POST', studioId: activeStudioId }));
      setMembers(await bffFetch<SegmentContactsDTO>(`studios/${activeStudioId}/segments/${segment.id}/contacts?limit=50`, { studioId: activeStudioId }));
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, t('common.error.generic')) });
    }
  }

  async function archive() {
    if (!segment) return;
    try {
      await bffFetch(`studios/${activeStudioId}/segments/${segment.id}`, { method: 'DELETE', studioId: activeStudioId });
      router.push('/segmentler');
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, t('common.error.generic')) });
    }
  }

  async function removeMember(contactId: string) {
    if (!segment) return;
    try {
      setSegment(await bffFetch<SegmentDTO>(`studios/${activeStudioId}/segments/${segment.id}/members`, { method: 'POST', studioId: activeStudioId, body: { add: [], remove: [contactId] } }));
      setMembers(await bffFetch<SegmentContactsDTO>(`studios/${activeStudioId}/segments/${segment.id}/contacts?limit=50`, { studioId: activeStudioId }));
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, t('common.error.generic')) });
    }
  }

  if (error) return <ErrorState message={error} />;
  if (!catalogue || (segmentId && !segment)) return <LoadingState />;

  const showRules = (segment ? segment.kind : kind) === 'DYNAMIC' || (!segment && seedFromRules);

  return (
    <div className="space-y-6">
      <PageHeader
        title={segment ? segment.name : t('segments.new')}
        subtitle={segment ? `${t(`segments.kind.${segment.kind}`)}, ${t('segments.preview.count', { count: segment.cachedCount })}${segment.refreshedAt ? `, ${fmt.dateTime(segment.refreshedAt)}` : ''}` : t('segments.subtitle')}
        actions={
          segment ? (
            <>
              {segment.kind === 'DYNAMIC' && (
                <PermissionButton required={['segments.manage']} onClick={refresh}>
                  {t('segments.action.refresh')}
                </PermissionButton>
              )}
              <PermissionButton required={['segments.manage']} variant="danger" onClick={archive}>
                {t('segments.action.archive')}
              </PermissionButton>
            </>
          ) : undefined
        }
      />
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Panel>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label={t('segments.field.name')} htmlFor="segment-name">
                <input id="segment-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} style={inputStyle} disabled={!canManage} />
              </Field>
              {!segment && (
                <Field label={t('segments.field.kind')} htmlFor="segment-kind" hint={t(`segments.kindHint.${kind}`)}>
                  <select id="segment-kind" value={kind} onChange={(e) => setKind(e.target.value === 'STATIC' ? 'STATIC' : 'DYNAMIC')} className={inputClass} style={inputStyle}>
                    <option value="DYNAMIC">{t('segments.kind.DYNAMIC')}</option>
                    <option value="STATIC">{t('segments.kind.STATIC')}</option>
                  </select>
                </Field>
              )}
              <div className="md:col-span-2">
                <Field label={t('segments.field.description')} htmlFor="segment-description">
                  <input id="segment-description" value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} style={inputStyle} disabled={!canManage} />
                </Field>
              </div>
              {!segment && kind === 'STATIC' && (
                <label className="inline-flex items-center gap-2 text-xs md:col-span-2" style={{ color: 'var(--color-text-primary)' }}>
                  <input type="checkbox" checked={seedFromRules} onChange={(e) => setSeedFromRules(e.target.checked)} />
                  {t('segments.seedFromRules')}
                </label>
              )}
            </div>
          </Panel>

          {showRules && (
            <Panel title={t('segments.builder.title')} labelledBy="segment-rules">
              <SegmentBuilder value={rules} onChange={setRules} catalogue={catalogue} />
            </Panel>
          )}

          {segment && (
            <Panel title={t('segments.members.title')} labelledBy="segment-members">
              {!members || members.items.length === 0 ? (
                <Muted>{t('common.empty')}</Muted>
              ) : (
                <ul className="space-y-1">
                  {members.items.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
                      <Link href={`/kisiler/${encodeURIComponent(m.id)}`} className="hover:underline" style={{ color: 'var(--color-text-primary)' }}>
                        {m.fullName}
                      </Link>
                      {segment.kind === 'STATIC' && canManage && (
                        <button type="button" className="text-xs underline" style={{ color: 'var(--color-text-muted)' }} onClick={() => removeMember(m.id)}>
                          {t('segments.members.remove')}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}

          <PermissionButton required={['segments.manage']} variant="primary" onClick={save} disabled={busy || !name.trim()}>
            {t('segments.action.save')}
          </PermissionButton>
        </div>

        {showRules && activeStudioId && (
          <div>
            <Panel title={t('segments.preview.title')} labelledBy="segment-preview">
              <SegmentPreview studioId={activeStudioId} rules={rules} />
            </Panel>
          </div>
        )}
      </div>
    </div>
  );
}
