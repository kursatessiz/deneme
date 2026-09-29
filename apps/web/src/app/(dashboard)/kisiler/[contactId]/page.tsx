'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { X } from 'lucide-react';
import type { ContactConsentDTO, ContactDetailDTO, ContactFieldDefinitionDTO, LoyaltyBalanceDTO } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { PageGuard } from '@/components/common/PageGuard';
import { PermissionButton } from '@/components/common/PermissionButton';
import { Badge } from '@/components/common/Badge';
import { ErrorState, LoadingState } from '@/components/common/DataState';
import { bffFetch } from '@/lib/session/client';
import { hasAnyPermission } from '@/lib/nav';
import { Muted, Notice, Panel, inputClass, inputStyle, errorMessage, useDateFormat } from '@/components/growth/ui';
import { stageLabel } from '@/components/growth/crm-labels';

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-sm py-1">
      <dt style={{ color: 'var(--color-text-muted)' }}>{label}</dt>
      <dd className="text-right" style={{ color: 'var(--color-text-primary)' }}>
        {value}
      </dd>
    </div>
  );
}

function ConsentRow({
  consent,
  canManage,
  onSave,
}: {
  consent: ContactConsentDTO;
  canManage: boolean;
  onSave: (granted: boolean, evidence?: string) => Promise<void>;
}) {
  const t = useT();
  const fmt = useDateFormat();
  const [evidence, setEvidence] = useState('');
  const [busy, setBusy] = useState(false);
  const granted = consent.status === 'GRANTED';
  const id = `consent-evidence-${consent.channel}`;
  return (
    <li className="py-2 space-y-2 border-t first:border-t-0" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
          {t(`messaging.channel.${consent.channel}`)}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={granted ? 'success' : 'neutral'}>{t(`crm.card.consent.${consent.status}`)}</Badge>
          {consent.suppressed && <Badge tone="warning">{t('crm.card.consent.suppressed')}</Badge>}
        </div>
      </div>
      <Muted>
        {`${t(`crm.card.consent.decidedBy.${consent.decidedBy}`)}${consent.source ? ` (${consent.source})` : ''}${
          granted && consent.grantedAt ? `, ${fmt.dateTime(consent.grantedAt)}` : !granted && consent.revokedAt ? `, ${fmt.dateTime(consent.revokedAt)}` : ''
        }${consent.evidence ? `: ${consent.evidence}` : ''}`}
      </Muted>
      {canManage && (
        <div className="flex flex-wrap items-end gap-2">
          {!granted && (
            <div className="flex-1 min-w-[12rem]">
              <label htmlFor={id} className="sr-only">
                {t('crm.card.consent.evidence')}
              </label>
              <input id={id} value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder={t('crm.card.consent.evidence')} className={inputClass} style={inputStyle} />
            </div>
          )}
          <button
            type="button"
            disabled={busy || (!granted && !evidence.trim())}
            onClick={async () => {
              setBusy(true);
              await onSave(!granted, granted ? undefined : evidence.trim());
              setEvidence('');
              setBusy(false);
            }}
            className="text-xs font-medium px-3 py-2 disabled:opacity-50"
            style={{ ...inputStyle, borderRadius: 'var(--radius-button)' }}
          >
            {granted ? t('crm.card.consent.revoke') : t('crm.card.consent.grant')}
          </button>
        </div>
      )}
    </li>
  );
}

function ContactCard({ contactId }: { contactId: string }) {
  const { activeStudioId, permissions, isOwner } = useDashboardSession();
  const t = useT();
  const locale = useLocale();
  const fmt = useDateFormat();
  const canManage = hasAnyPermission(['crm.manage'], permissions, isOwner);
  const [contact, setContact] = useState<ContactDetailDTO | null>(null);
  const [fields, setFields] = useState<ContactFieldDefinitionDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [newTag, setNewTag] = useState('');
  const [note, setNote] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDue, setTaskDue] = useState('');
  const [loyalty, setLoyalty] = useState<(LoyaltyBalanceDTO & { membershipId: string | null }) | null>(null);
  const canViewLoyalty = hasAnyPermission(['loyalty.view'], permissions, isOwner);

  const base = `crm/studios/${activeStudioId}`;
  const load = useCallback(() => {
    if (!activeStudioId) return;
    bffFetch<ContactDetailDTO>(`${base}/contacts/${contactId}`, { studioId: activeStudioId })
      .then((c) => {
        setContact(c);
        setError(null);
      })
      .catch((err) => setError(errorMessage(err, t('common.error.generic'))));
  }, [activeStudioId, base, contactId, t]);

  useEffect(() => {
    load();
    if (!activeStudioId) return;
    bffFetch<ContactFieldDefinitionDTO[]>(`${base}/fields`, { studioId: activeStudioId })
      .then(setFields)
      .catch(() => setFields([]));
  }, [load, activeStudioId, base]);

  useEffect(() => {
    // G3a: a balance line for members of a running loyalty program; quietly absent otherwise.
    if (!activeStudioId || !canViewLoyalty) return;
    bffFetch<LoyaltyBalanceDTO & { membershipId: string | null }>(`studios/${activeStudioId}/loyalty/contacts/${contactId}/balance`, { studioId: activeStudioId })
      .then(setLoyalty)
      .catch(() => setLoyalty(null));
  }, [activeStudioId, canViewLoyalty, contactId]);

  async function act(fn: () => Promise<unknown>) {
    setActionError(null);
    try {
      await fn();
      load();
    } catch (err) {
      setActionError(errorMessage(err, t('common.error.generic')));
    }
  }

  if (error) return <ErrorState message={error} />;
  if (!contact) return <LoadingState />;

  const fieldLabel = (f: ContactFieldDefinitionDTO) => f.label[locale] ?? f.label.tr ?? Object.values(f.label)[0] ?? f.key;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link href="/kisiler" className="text-xs hover:underline" style={{ color: 'var(--color-text-secondary)' }}>
          {t('crm.card.back')}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
            {contact.fullName}
          </h2>
          <Badge>{t(`crm.lifecycle.${contact.lifecycleStage}`)}</Badge>
          {contact.pipelineStage && <Badge tone="info">{stageLabel(contact.pipelineStage, t)}</Badge>}
        </div>
      </div>
      {actionError && <Notice tone="error">{actionError}</Notice>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="space-y-4">
          <Panel title={t('crm.card.details')} labelledBy="card-details">
            <dl>
              <DetailRow label={t('crm.card.phone')} value={contact.phone ?? t('crm.card.none')} />
              <DetailRow label={t('crm.card.email')} value={contact.email ?? t('crm.card.none')} />
              <DetailRow label={t('crm.card.locale')} value={contact.locale ?? t('crm.card.none')} />
              <DetailRow label={t('crm.card.country')} value={contact.countryCode ?? t('crm.card.none')} />
              <DetailRow label={t('crm.card.timezone')} value={contact.timezone ?? t('crm.card.none')} />
              <DetailRow label={t('crm.card.owner')} value={contact.ownerName ?? t('crm.card.none')} />
              <DetailRow label={t('crm.card.sourceChannel')} value={contact.sourceChannel ?? t('crm.card.none')} />
              <DetailRow label={t('crm.contacts.col.createdAt')} value={fmt.date(contact.createdAt)} />
              {loyalty && loyalty.enabled && loyalty.membershipId && (
                <DetailRow label={t('loyalty.contact.balance')} value={t('loyalty.points', { count: loyalty.balance })} />
              )}
            </dl>
          </Panel>

          <Panel title={t('crm.card.tags')} labelledBy="card-tags">
            <div className="flex flex-wrap gap-1.5">
              {contact.tags.length === 0 && <Muted>{t('crm.card.none')}</Muted>}
              {contact.tags.map((tag) => (
                <span key={tag} className="inline-flex items-center gap-1">
                  <Badge tone="info">{tag}</Badge>
                  {canManage && (
                    <button
                      type="button"
                      aria-label={t('crm.card.removeTag', { tag })}
                      className="text-xs px-1"
                      style={{ color: 'var(--color-text-muted)' }}
                      onClick={() => act(() => bffFetch(`${base}/contacts/${contact.id}/tags`, { method: 'POST', studioId: activeStudioId, body: { add: [], remove: [tag] } }))}
                    >
                      <X className="w-3 h-3" aria-hidden="true" />
                    </button>
                  )}
                </span>
              ))}
            </div>
            {canManage && (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newTag.trim()) return;
                  const tag = newTag.trim();
                  setNewTag('');
                  act(() => bffFetch(`${base}/contacts/${contact.id}/tags`, { method: 'POST', studioId: activeStudioId, body: { add: [tag], remove: [] } }));
                }}
              >
                <label htmlFor="new-tag" className="sr-only">
                  {t('crm.card.addTag')}
                </label>
                <input id="new-tag" value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder={t('crm.card.addTag')} className={inputClass} style={inputStyle} />
                <button type="submit" className="text-xs font-medium px-3" style={{ ...inputStyle, borderRadius: 'var(--radius-button)' }}>
                  {t('common.add')}
                </button>
              </form>
            )}
          </Panel>

          <Panel title={t('crm.card.customFields')} labelledBy="card-fields">
            {fields.length === 0 ? (
              <Muted>{t('crm.card.noCustomFields')}</Muted>
            ) : (
              <dl>
                {fields.map((f) => {
                  const value = contact.customFields[f.key];
                  const shown = value === undefined || value === null ? t('crm.card.none') : typeof value === 'boolean' ? t(value ? 'common.yes' : 'common.no') : String(value);
                  return <DetailRow key={f.key} label={fieldLabel(f)} value={shown} />;
                })}
              </dl>
            )}
          </Panel>

          <Panel title={t('crm.card.consent')} labelledBy="card-consent">
            <Muted>{t('crm.card.consentHint')}</Muted>
            <ul>
              {contact.consents.map((c) => (
                <ConsentRow
                  key={c.channel}
                  consent={c}
                  canManage={canManage}
                  onSave={(granted, evidence) =>
                    act(() => bffFetch(`${base}/contacts/${contact.id}/consents`, { method: 'PUT', studioId: activeStudioId, body: { channel: c.channel, granted, ...(evidence ? { evidence } : {}) } }))
                  }
                />
              ))}
            </ul>
          </Panel>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Panel title={t('crm.card.tasks')} labelledBy="card-tasks">
            {contact.tasks.length === 0 && <Muted>{t('crm.card.noTasks')}</Muted>}
            <ul className="space-y-1">
              {contact.tasks.map((task) => (
                <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 text-sm py-1">
                  <span style={{ color: 'var(--color-text-primary)', textDecoration: task.status === 'DONE' ? 'line-through' : undefined }}>{task.title}</span>
                  <span className="flex items-center gap-2">
                    {task.dueAt && <Muted>{fmt.dateTime(task.dueAt)}</Muted>}
                    <Badge tone={task.status === 'OPEN' ? 'warning' : 'neutral'}>{t(`crm.task.${task.status}`)}</Badge>
                    {canManage && task.status === 'OPEN' && (
                      <button
                        type="button"
                        className="text-xs underline"
                        style={{ color: 'var(--color-text-secondary)' }}
                        onClick={() => act(() => bffFetch(`${base}/tasks/${task.id}`, { method: 'PATCH', studioId: activeStudioId, body: { status: 'DONE' } }))}
                      >
                        {t('crm.card.completeTask')}
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {canManage && (
              <form
                className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!taskTitle.trim()) return;
                  const body = { title: taskTitle.trim(), ...(taskDue ? { dueAt: new Date(taskDue).toISOString() } : {}) };
                  setTaskTitle('');
                  setTaskDue('');
                  act(() => bffFetch(`${base}/contacts/${contact.id}/tasks`, { method: 'POST', studioId: activeStudioId, body }));
                }}
              >
                <label htmlFor="task-title" className="sr-only">
                  {t('crm.card.taskTitle')}
                </label>
                <input id="task-title" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder={t('crm.card.taskTitle')} className={inputClass} style={inputStyle} />
                <label htmlFor="task-due" className="sr-only">
                  {t('crm.card.taskDue')}
                </label>
                <input id="task-due" type="datetime-local" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} className={inputClass} style={inputStyle} />
                <button type="submit" className="text-xs font-medium px-3 py-2" style={{ ...inputStyle, borderRadius: 'var(--radius-button)' }}>
                  {t('crm.card.addTask')}
                </button>
              </form>
            )}
          </Panel>

          <Panel title={t('crm.card.timeline')} labelledBy="card-timeline">
            {canManage && (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!note.trim()) return;
                  const body = { type: 'NOTE', body: note.trim() };
                  setNote('');
                  act(() => bffFetch(`${base}/contacts/${contact.id}/activities`, { method: 'POST', studioId: activeStudioId, body }));
                }}
              >
                <label htmlFor="note" className="sr-only">
                  {t('crm.card.note')}
                </label>
                <input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('crm.card.note')} className={inputClass} style={inputStyle} />
                <PermissionButton required={['crm.manage']} type="submit">
                  {t('crm.card.addNote')}
                </PermissionButton>
              </form>
            )}
            {contact.activities.length === 0 && <Muted>{t('crm.card.noActivity')}</Muted>}
            <ol className="space-y-2" aria-label={t('crm.card.timeline')}>
              {contact.activities.map((a) => (
                <li key={a.id} className="text-sm border-l-2 pl-3" style={{ borderColor: 'var(--color-border)' }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{t(`crm.activity.${a.type}`)}</Badge>
                    <Muted>{`${fmt.dateTime(a.createdAt)}${a.actorName ? `, ${a.actorName}` : ''}`}</Muted>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap" style={{ color: 'var(--color-text-primary)' }}>
                    {a.body}
                  </p>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel title={t('crm.card.attribution')} labelledBy="card-attribution">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
              <DetailRow label={t('crm.card.firstTouch')} value={[contact.firstSource, contact.firstCampaignId].filter(Boolean).join(' / ') || t('crm.card.none')} />
              <DetailRow label={t('crm.card.lastTouch')} value={[contact.lastSource, contact.lastCampaignId].filter(Boolean).join(' / ') || t('crm.card.none')} />
            </dl>
            {contact.touchpoints.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                  {t('crm.card.touchpoints')}
                </p>
                <ul className="text-xs space-y-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                  {contact.touchpoints.slice(0, 10).map((tp) => (
                    <li key={tp.id}>{`${fmt.dateTime(tp.occurredAt)}: ${[tp.utmSource, tp.utmMedium, tp.utmCampaign].filter(Boolean).join(' / ') || tp.referrerHost || tp.landingPath}`}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              {t('crm.card.conversions')}
            </p>
            {contact.conversions.length === 0 ? (
              <Muted>{t('crm.card.noConversions')}</Muted>
            ) : (
              <ul className="text-xs space-y-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                {contact.conversions.map((cv) => (
                  <li key={cv.id}>{`${fmt.dateTime(cv.occurredAt)}: ${t(`journeys.event.${cv.type}`)}${cv.valueAmount && cv.currency ? `, ${new Intl.NumberFormat(locale, { style: 'currency', currency: cv.currency }).format(Number(cv.valueAmount))}` : ''}`}</li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  const { contactId } = useParams<{ contactId: string }>();
  return (
    <PageGuard required={['crm.view']}>
      <ContactCard contactId={contactId} />
    </PageGuard>
  );
}
