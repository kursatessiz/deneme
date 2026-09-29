'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { MESSAGE_CHANNELS_V2 } from '@platform/shared';
import type { CampaignDTO, CampaignRecipientDTO, CampaignTestSendResultDTO, MessageTemplateListDTO, SegmentDTO } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { PermissionButton } from '@/components/common/PermissionButton';
import { Badge } from '@/components/common/Badge';
import { ErrorState, LoadingState } from '@/components/common/DataState';
import { bffFetch } from '@/lib/session/client';
import { hasAnyPermission } from '@/lib/nav';
import { Field, Muted, Notice, PageHeader, Panel, inputClass, inputStyle, errorMessage, useDateFormat } from './ui';

const EDITABLE = new Set(['DRAFT', 'SCHEDULED']);

export function campaignStatusTone(status: CampaignDTO['status']): 'neutral' | 'info' | 'success' | 'warning' {
  if (status === 'SENT') return 'success';
  if (status === 'SENDING' || status === 'SCHEDULED') return 'info';
  if (status === 'CANCELLED') return 'warning';
  return 'neutral';
}

/** The local datetime-local value for an ISO instant (in the viewer's zone). */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-1">
      <dt className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        {label}
      </dt>
      <dd className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
        {value}
      </dd>
    </div>
  );
}

/** Campaign create/edit, schedule, test send, cancel, and results with recipients. */
export function CampaignEditor({ campaignId }: { campaignId?: string }) {
  const { activeStudioId, permissions, isOwner } = useDashboardSession();
  const t = useT();
  const locale = useLocale();
  const fmt = useDateFormat();
  const router = useRouter();
  const canManage = hasAnyPermission(['campaigns.manage'], permissions, isOwner);
  const [campaign, setCampaign] = useState<CampaignDTO | null>(null);
  const [segments, setSegments] = useState<SegmentDTO[]>([]);
  const [templateKeys, setTemplateKeys] = useState<string[] | null>(null);
  const [recipients, setRecipients] = useState<CampaignRecipientDTO[]>([]);
  const [name, setName] = useState('');
  const [segmentId, setSegmentId] = useState('');
  const [channel, setChannel] = useState('');
  const [templateKey, setTemplateKey] = useState('');
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'error' | 'success' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const base = `studios/${activeStudioId}/campaigns`;

  const loadCampaign = useCallback(async () => {
    if (!campaignId || !activeStudioId) return;
    try {
      const c = await bffFetch<CampaignDTO>(`${base}/${campaignId}`, { studioId: activeStudioId });
      setCampaign(c);
      setName(c.name);
      setSegmentId(c.segmentId);
      setChannel(c.channel ?? '');
      setTemplateKey(c.templateKey);
      if (c.scheduledAt && c.status === 'SCHEDULED') {
        setWhen('later');
        setScheduledAt(toLocalInput(c.scheduledAt));
      }
      if (!EDITABLE.has(c.status)) {
        const res = await bffFetch<{ items: CampaignRecipientDTO[] }>(`${base}/${campaignId}/recipients?limit=100`, { studioId: activeStudioId });
        setRecipients(res.items);
      }
    } catch (err) {
      setError(errorMessage(err, t('common.error.generic')));
    }
  }, [activeStudioId, base, campaignId, t]);

  useEffect(() => {
    if (!activeStudioId) return;
    bffFetch<{ items: SegmentDTO[] }>(`studios/${activeStudioId}/segments`, { studioId: activeStudioId })
      .then((res) => setSegments(res.items))
      .catch(() => setSegments([]));
    // Template keys need notifications.manage; without it the key is typed by hand.
    bffFetch<MessageTemplateListDTO>(`studios/${activeStudioId}/messaging/templates`, { studioId: activeStudioId })
      .then((res) => setTemplateKeys([...new Set(res.items.map((i) => i.key))].sort()))
      .catch(() => setTemplateKeys(null));
    loadCampaign();
  }, [activeStudioId, loadCampaign]);

  const editable = !campaign || EDITABLE.has(campaign.status);
  const selectedSegment = segments.find((s) => s.id === segmentId);

  async function saveDraft(): Promise<CampaignDTO | null> {
    const body = { name, segmentId, templateKey, ...(campaign ? { channel: channel || null } : channel ? { channel } : {}) };
    try {
      const saved = campaign
        ? await bffFetch<CampaignDTO>(`${base}/${campaign.id}`, { method: 'PATCH', studioId: activeStudioId, body })
        : await bffFetch<CampaignDTO>(base, { method: 'POST', studioId: activeStudioId, body });
      setCampaign(saved);
      return saved;
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, t('common.error.generic')) });
      return null;
    }
  }

  async function run(action: 'save' | 'schedule') {
    setBusy(true);
    setNotice(null);
    const saved = await saveDraft();
    if (saved && action === 'schedule') {
      try {
        const scheduled = await bffFetch<CampaignDTO>(`${base}/${saved.id}/schedule`, {
          method: 'POST',
          studioId: activeStudioId,
          body: when === 'later' && scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {},
        });
        setCampaign(scheduled);
        setNotice({ tone: 'success', text: t('campaigns.scheduled') });
      } catch (err) {
        setNotice({ tone: 'error', text: errorMessage(err, t('common.error.generic')) });
      }
    } else if (saved) {
      setNotice({ tone: 'success', text: t('campaigns.saved') });
    }
    setBusy(false);
    if (saved && !campaignId) router.push(`/kampanyalar/${saved.id}`);
  }

  async function testSend() {
    setNotice(null);
    const saved = campaign ?? (await saveDraft());
    if (!saved) return;
    try {
      const res = await bffFetch<CampaignTestSendResultDTO>(`${base}/${saved.id}/test-send`, { method: 'POST', studioId: activeStudioId });
      setNotice(
        res.success
          ? { tone: 'success', text: t('campaigns.testSent', { channel: t(`messaging.channel.${res.channel ?? 'SMS'}`) }) }
          : { tone: 'info', text: t('campaigns.testSkipped', { reason: t(`campaigns.reason.${res.reasonCode ?? 'UNKNOWN'}`) }) },
      );
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, t('common.error.generic')) });
    }
  }

  async function remove() {
    if (!campaign) return;
    try {
      await bffFetch(`${base}/${campaign.id}`, { method: 'DELETE', studioId: activeStudioId });
      router.push('/kampanyalar');
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, t('common.error.generic')) });
    }
  }

  async function cancel() {
    if (!campaign) return;
    try {
      setCampaign(await bffFetch<CampaignDTO>(`${base}/${campaign.id}/cancel`, { method: 'POST', studioId: activeStudioId }));
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, t('common.error.generic')) });
    }
  }

  if (error) return <ErrorState message={error} />;
  if (campaignId && !campaign) return <LoadingState />;

  const stats = campaign?.stats;
  const money = (currency: string, amount: string) => new Intl.NumberFormat(locale, { style: 'currency', currency }).format(Number(amount));

  return (
    <div className="space-y-6">
      <PageHeader
        title={campaign ? campaign.name : t('campaigns.new')}
        subtitle={t('campaigns.subtitle')}
        actions={
          <>
            {campaign && <Badge tone={campaignStatusTone(campaign.status)}>{t(`campaigns.status.${campaign.status}`)}</Badge>}
            <Link href="/kampanyalar" className="text-xs underline" style={{ color: 'var(--color-text-secondary)' }}>
              {t('campaigns.title')}
            </Link>
          </>
        }
      />
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {!editable && <Muted>{t('campaigns.locked')}</Muted>}

      <Panel>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label={t('campaigns.field.name')} htmlFor="campaign-name">
            <input id="campaign-name" value={name} onChange={(e) => setName(e.target.value)} disabled={!editable || !canManage} className={inputClass} style={inputStyle} />
          </Field>
          <Field
            label={t('campaigns.field.segment')}
            htmlFor="campaign-segment"
            hint={selectedSegment ? t('campaigns.audience', { count: selectedSegment.cachedCount }) : undefined}
          >
            <select id="campaign-segment" value={segmentId} onChange={(e) => setSegmentId(e.target.value)} disabled={!editable || !canManage} className={inputClass} style={inputStyle}>
              <option value="" disabled>
                {t('campaigns.field.segment')}
              </option>
              {segments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('campaigns.field.channel')} htmlFor="campaign-channel">
            <select id="campaign-channel" value={channel} onChange={(e) => setChannel(e.target.value)} disabled={!editable || !canManage} className={inputClass} style={inputStyle}>
              <option value="">{t('campaigns.field.channelDefault')}</option>
              {MESSAGE_CHANNELS_V2.map((c) => (
                <option key={c} value={c}>
                  {t(`messaging.channel.${c}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('campaigns.field.template')} htmlFor="campaign-template" hint={t('campaigns.field.templateHint')}>
            {templateKeys ? (
              <select id="campaign-template" value={templateKey} onChange={(e) => setTemplateKey(e.target.value)} disabled={!editable || !canManage} className={inputClass} style={inputStyle}>
                <option value="" disabled>
                  {t('campaigns.field.template')}
                </option>
                {templateKeys.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="campaign-template"
                value={templateKey}
                onChange={(e) => setTemplateKey(e.target.value.toUpperCase())}
                disabled={!editable || !canManage}
                className={inputClass}
                style={inputStyle}
              />
            )}
          </Field>
          {editable && (
            <fieldset className="md:col-span-2 space-y-2">
              <legend className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                {t('campaigns.field.scheduledAt')}
              </legend>
              <div className="flex flex-wrap items-center gap-4 text-sm" style={{ color: 'var(--color-text-primary)' }}>
                <label className="inline-flex items-center gap-2">
                  <input type="radio" name="campaign-when" checked={when === 'now'} onChange={() => setWhen('now')} />
                  {t('campaigns.field.scheduleNow')}
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="radio" name="campaign-when" checked={when === 'later'} onChange={() => setWhen('later')} />
                  {t('campaigns.field.scheduleLater')}
                </label>
                {when === 'later' && (
                  <input
                    type="datetime-local"
                    aria-label={t('campaigns.field.scheduledAt')}
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    className={`${inputClass} max-w-xs`}
                    style={inputStyle}
                  />
                )}
              </div>
            </fieldset>
          )}
        </div>
        <Muted>{t('campaigns.compliance')}</Muted>
        {editable && canManage && (
          <div className="flex flex-wrap gap-2">
            <PermissionButton required={['campaigns.manage']} onClick={() => run('save')} disabled={busy || !name.trim() || !segmentId || !templateKey}>
              {t('campaigns.action.save')}
            </PermissionButton>
            <PermissionButton required={['campaigns.manage']} onClick={testSend} disabled={busy || !name.trim() || !segmentId || !templateKey}>
              {t('campaigns.action.testSend')}
            </PermissionButton>
            <PermissionButton
              required={['campaigns.manage']}
              variant="primary"
              onClick={() => run('schedule')}
              disabled={busy || !name.trim() || !segmentId || !templateKey || (when === 'later' && !scheduledAt)}
            >
              {when === 'now' ? t('campaigns.action.sendNow') : t('campaigns.action.schedule')}
            </PermissionButton>
          </div>
        )}
        {campaign?.status === 'DRAFT' && (
          <PermissionButton required={['campaigns.manage']} variant="danger" onClick={remove}>
            {t('campaigns.action.delete')}
          </PermissionButton>
        )}
        {campaign && (campaign.status === 'SCHEDULED' || campaign.status === 'SENDING') && (
          <PermissionButton required={['campaigns.manage']} variant="danger" onClick={cancel}>
            {t('campaigns.action.cancel')}
          </PermissionButton>
        )}
      </Panel>

      {stats && campaign && campaign.status !== 'DRAFT' && (
        <Panel title={t('campaigns.stats.title')} labelledBy="campaign-stats">
          <dl className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            <Stat label={t('campaigns.stats.audience')} value={fmt.number(stats.audience)} />
            <Stat label={t('campaigns.stats.sent')} value={fmt.number(stats.sent)} />
            <Stat label={t('campaigns.stats.pending')} value={fmt.number(stats.pending)} />
            <Stat label={t('campaigns.stats.skipped')} value={fmt.number(stats.skipped)} />
            <Stat label={t('campaigns.stats.failed')} value={fmt.number(stats.failed)} />
            <Stat label={t('campaigns.stats.delivered')} value={fmt.number(stats.delivered)} />
            <Stat label={t('campaigns.stats.opened')} value={fmt.number(stats.opened)} />
            <Stat label={t('campaigns.stats.clicked')} value={fmt.number(stats.clicked)} />
            <Stat label={t('campaigns.stats.unsubscribed')} value={fmt.number(stats.unsubscribed)} />
            <Stat label={t('campaigns.stats.converted')} value={fmt.number(stats.converted)} />
            <Stat
              label={t('campaigns.stats.revenue')}
              value={Object.entries(stats.revenue).map(([cur, amount]) => money(cur, amount)).join(', ') || fmt.number(0)}
            />
          </dl>
          {Object.keys(stats.skippedByReason).length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                {t('campaigns.stats.skippedByReason')}
              </p>
              <ul className="flex flex-wrap gap-2">
                {Object.entries(stats.skippedByReason).map(([reason, count]) => (
                  <li key={reason}>
                    <Badge>{`${t(`campaigns.reason.${reason}`)}: ${fmt.number(count)}`}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      )}

      {recipients.length > 0 && (
        <Panel title={t('campaigns.recipients.title')} labelledBy="campaign-recipients">
          <ul className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
            {recipients.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
                <Link href={`/kisiler/${encodeURIComponent(r.contactId)}`} className="hover:underline" style={{ color: 'var(--color-text-primary)' }}>
                  {r.fullName}
                </Link>
                <span className="flex items-center gap-2">
                  {r.reasonCode && r.status !== 'SENT' && <Muted>{t(`campaigns.reason.${r.reasonCode}`)}</Muted>}
                  <Badge tone={r.status === 'SENT' ? 'success' : r.status === 'FAILED' ? 'danger' : 'neutral'}>{t(`campaigns.recipient.${r.status}`)}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
