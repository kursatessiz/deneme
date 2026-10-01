'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  SOCIAL_NETWORK_LIMITS,
  SOCIAL_POST_STATUSES,
  socialTextLength,
  validateSocialPostShape,
  type ApprovalRequestDTO,
  type MessageKey,
  type SocialConnectionDTO,
  type SocialPostDTO,
  type SocialPostListDTO,
  type SocialPostStatus,
} from '@platform/shared';
import { bffFetch, BffError } from '@/lib/session/client';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { Badge } from '@/components/common/Badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/DataState';
import { InlineMessage, PrimaryButton, SecondaryButton, Section, SettingsHeader } from '@/components/settings/ui';
import { AreaField, InputField, LinkButton, SelectField } from '../fields';
import { usePlatformSession } from '../PlatformSession';
import { IssueList } from '../studio/VariantEditor';
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const STATUS_TONE: Record<SocialPostStatus, Tone> = {
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'warning',
  SCHEDULED: 'info',
  PUBLISHING: 'info',
  PUBLISHED: 'success',
  FAILED: 'danger',
  CANCELLED: 'neutral',
};

interface Form {
  id: string | null;
  connectionId: string;
  locale: string;
  text: string;
  link: string;
  media: string[];
  mediaDraft: string;
  scheduledAt: string;
  calendarItemId: string | null;
}

/** ISO instant to the value of a datetime-local input (the viewer's own zone). */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function urlParams(): URLSearchParams {
  return new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
}

/**
 * Organic social posts of the marketing panel (/pazarlama/sosyal, M4b): the
 * list with a status filter and the composer (account, text with the
 * network's own length counter, link, media links, publish time). The brand
 * check and the approval state come from the API; approve and reject are
 * shown to super admins only and go through the approval queue endpoints.
 * Every rule is enforced again by the API.
 */
export function SocialPosts() {
  const t = useT();
  const locale = useLocale();
  const { permissions, isSuperAdmin } = usePlatformSession();
  const canManage = isSuperAdmin || permissions.includes('platform.marketing.manage');
  const canSend = isSuperAdmin || permissions.includes('platform.marketing.send');
  const canIntegrations = isSuperAdmin || permissions.includes('platform.integrations.manage');

  const [status, setStatus] = useState<SocialPostStatus | ''>('');
  const [posts, setPosts] = useState<SocialPostDTO[] | null>(null);
  const [connections, setConnections] = useState<SocialConnectionDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [current, setCurrent] = useState<SocialPostDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const fmtDate = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }), [locale]);
  const fmtNumber = useMemo(() => new Intl.NumberFormat(locale), [locale]);

  const load = useCallback(async () => {
    try {
      setError(null);
      const query = status ? `?status=${status}` : '';
      const [list, accounts] = await Promise.all([
        bffFetch<SocialPostListDTO>(`platform/marketing/social-posts${query}`),
        bffFetch<SocialConnectionDTO[]>('platform/marketing/social-posts/connections'),
      ]);
      setPosts(list.items);
      setConnections(accounts);
    } catch {
      setError(t('marketingSocial.loadFailed'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const emptyForm = useCallback(
    (over: Partial<Form> = {}): Form => ({
      id: null,
      connectionId: connections[0]?.id ?? '',
      locale,
      text: '',
      link: '',
      media: [],
      mediaDraft: '',
      scheduledAt: '',
      calendarItemId: null,
      ...over,
    }),
    [connections, locale],
  );

  const openPost = useCallback(
    (post: SocialPostDTO) => {
      setCurrent(post);
      setMessage(null);
      setForm({
        id: post.id,
        connectionId: post.connectionId,
        locale: post.locale,
        text: post.text,
        link: post.link ?? '',
        media: post.mediaUrls,
        mediaDraft: '',
        scheduledAt: toLocalInput(post.scheduledAt),
        calendarItemId: post.calendarItemId,
      });
    },
    [],
  );

  // Links from the calendar and from notifications: ?id=<post> opens it, ?calendarItemId=<item>&title=... starts a post for the item.
  const [linked, setLinked] = useState(false);
  useEffect(() => {
    if (linked || posts === null) return;
    setLinked(true);
    const params = urlParams();
    const id = params.get('id');
    const calendarItemId = params.get('calendarItemId');
    if (id) {
      bffFetch<SocialPostDTO>(`platform/marketing/social-posts/${encodeURIComponent(id)}`)
        .then(openPost)
        .catch(() => undefined);
    } else if (calendarItemId && canManage) {
      setForm(emptyForm({ calendarItemId, text: params.get('title') ?? '' }));
    }
  }, [linked, posts, canManage, emptyForm, openPost]);

  const provider = useMemo(() => connections.find((c) => c.id === form?.connectionId)?.provider ?? null, [connections, form?.connectionId]);
  const limits = provider ? SOCIAL_NETWORK_LIMITS[provider] : null;
  const count = provider && form ? socialTextLength(provider, form.text, form.link.trim() || null) : 0;
  const over = limits ? count > limits.maxTextLength : false;
  const shapeIssues = provider && form ? validateSocialPostShape(provider, { mediaUrls: form.media }) : [];
  const editable = !current || ['DRAFT', 'PENDING_APPROVAL', 'SCHEDULED', 'FAILED'].includes(current.status);

  const errorText = (err: unknown) => (err instanceof BffError && err.message ? err.message : t('marketingSocial.actionFailed'));

  function payload(f: Form) {
    return {
      connectionId: f.connectionId,
      locale: f.locale,
      text: f.text.trim(),
      mediaUrls: f.media,
      link: f.link.trim() === '' ? null : f.link.trim(),
      scheduledAt: fromLocalInput(f.scheduledAt),
      ...(f.calendarItemId ? { calendarItemId: f.calendarItemId } : {}),
    };
  }

  /** Creates or updates the post and returns the saved version. */
  async function persist(f: Form): Promise<SocialPostDTO> {
    if (f.id) return bffFetch<SocialPostDTO>(`platform/marketing/social-posts/${f.id}`, { method: 'PATCH', body: payload(f) });
    return bffFetch<SocialPostDTO>('platform/marketing/social-posts', { method: 'POST', body: payload(f) });
  }

  async function run(action: 'save' | 'schedule' | 'publish') {
    if (!form) return;
    setBusy(true);
    setMessage(null);
    try {
      let saved = await persist(form);
      openPost(saved);
      let text: string;
      if (action === 'schedule') {
        const at = fromLocalInput(form.scheduledAt);
        if (!at) return;
        saved = await bffFetch<SocialPostDTO>(`platform/marketing/social-posts/${saved.id}/schedule`, { method: 'POST', body: { scheduledAt: at } });
        text = t(saved.status === 'PENDING_APPROVAL' ? 'marketingSocial.composer.approvalRequested' : 'marketingSocial.composer.scheduledOk');
      } else if (action === 'publish') {
        saved = await bffFetch<SocialPostDTO>(`platform/marketing/social-posts/${saved.id}/publish-now`, { method: 'POST', body: {} });
        text = t(saved.status === 'PENDING_APPROVAL' ? 'marketingSocial.composer.approvalRequested' : 'marketingSocial.composer.published');
      } else {
        text = t('marketingSocial.composer.saved');
      }
      // openPost clears the message, so the outcome is set after the final refresh of the form.
      openPost(saved);
      setMessage({ tone: 'success', text });
    } catch (err) {
      setMessage({ tone: 'error', text: errorText(err) });
      // A quota answer leaves the post scheduled: show its real state.
      if (form.id) bffFetch<SocialPostDTO>(`platform/marketing/social-posts/${form.id}`).then(openPost).catch(() => undefined);
    } finally {
      setBusy(false);
      void load();
    }
  }

  async function cancelPost() {
    if (!current) return;
    setBusy(true);
    try {
      openPost(await bffFetch<SocialPostDTO>(`platform/marketing/social-posts/${current.id}/cancel`, { method: 'POST', body: {} }));
      setMessage({ tone: 'success', text: t('marketingSocial.composer.cancelled') });
    } catch (err) {
      setMessage({ tone: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
      void load();
    }
  }

  async function removePost() {
    if (!current || !window.confirm(t('marketingSocial.composer.confirmDelete'))) return;
    setBusy(true);
    try {
      await bffFetch(`platform/marketing/social-posts/${current.id}`, { method: 'DELETE' });
      setForm(null);
      setCurrent(null);
    } catch (err) {
      setMessage({ tone: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
      void load();
    }
  }

  async function decide(action: 'approve' | 'reject') {
    if (!current?.approval) return;
    setBusy(true);
    try {
      await bffFetch<ApprovalRequestDTO>(`platform/marketing/approvals/${current.approval.id}/${action}`, {
        method: 'POST',
        body: rejectNote.trim() ? { note: rejectNote.trim() } : {},
      });
      setRejectNote('');
      setMessage({ tone: 'success', text: t('marketingSocial.approval.decided') });
    } catch (err) {
      setMessage({ tone: 'error', text: errorText(err) });
    } finally {
      const fresh = await bffFetch<SocialPostDTO>(`platform/marketing/social-posts/${current.id}`).catch(() => null);
      if (fresh) openPost(fresh);
      setBusy(false);
      void load();
    }
  }

  const statusOptions = [{ value: '', label: t('marketingSocial.filter.all') }, ...SOCIAL_POST_STATUSES.map((s) => ({ value: s, label: t(`marketingSocial.status.${s}`) }))];
  const canSubmit = form !== null && form.connectionId !== '' && form.text.trim() !== '' && !over && shapeIssues.length === 0 && !busy;

  return (
    <div className="space-y-5">
      <SettingsHeader title={t('marketingSocial.title')} description={t('marketingSocial.subtitle')} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-56">
          <SelectField label={t('marketingSocial.filter.label')} value={status} onChange={(v) => setStatus(v as SocialPostStatus | '')} options={statusOptions} />
        </div>
        {canManage && (
          <PrimaryButton
            onClick={() => {
              setCurrent(null);
              setMessage(null);
              setForm(emptyForm());
            }}
          >
            {t('marketingSocial.new')}
          </PrimaryButton>
        )}
      </div>

      {error ? (
        <ErrorState message={error} />
      ) : posts === null ? (
        <LoadingState />
      ) : posts.length === 0 ? (
        <EmptyState title={t('marketingSocial.empty')} />
      ) : (
        <div className="overflow-x-auto pui-card">
          <Table>
            <Thead>
              <Tr>
                <Th>{t('marketingSocial.col.text')}</Th>
                <Th>{t('marketingSocial.col.account')}</Th>
                <Th>{t('marketingSocial.col.status')}</Th>
                <Th>{t('marketingSocial.col.scheduled')}</Th>
              </Tr>
            </Thead>
            <Tbody>
              {posts.map((post) => (
                <Tr key={post.id}>
                  <Td className="max-w-md">
                    <LinkButton onClick={() => openPost(post)}>
                      <span className="line-clamp-2 text-left">{post.text}</span>
                    </LinkButton>
                  </Td>
                  <Td>
                    <span className="ui-strong">{post.connectionName}</span>
                    <span className="block ui-caption">
                      {t(`marketingSocial.provider.${post.provider}`)}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONE[post.status]}>{t(`marketingSocial.status.${post.status}`)}</Badge>
                  </Td>
                  <Td className="ui-caption">
                    {post.scheduledAt ? fmtDate.format(new Date(post.scheduledAt)) : t('marketingSocial.unscheduled')}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      )}

      {form && (
        <Section title={current ? t(editable && canManage ? 'marketingSocial.composer.editTitle' : 'marketingSocial.composer.viewTitle') : t('marketingSocial.composer.newTitle')}>
          {message && <InlineMessage text={message.text} tone={message.tone} />}
          {!editable && <InlineMessage text={t('marketingSocial.composer.readOnly')} />}
          {connections.length === 0 && (
            <p className="ui-text-muted">
              {t('marketingSocial.composer.noConnections')}{' '}
              {canIntegrations && (
                <Link href="/pazarlama/entegrasyonlar" className="pui-link pui-surface">
                  {t('marketingSocial.composer.connectionsLink')}
                </Link>
              )}
            </p>
          )}
          {current && (
            <div className="flex flex-wrap items-center gap-2 ui-caption">
              <Badge tone={STATUS_TONE[current.status]}>{t(`marketingSocial.status.${current.status}`)}</Badge>
              {current.publishedAt && <span>{t('marketingSocial.detail.published', { date: fmtDate.format(new Date(current.publishedAt)) })}</span>}
              {current.externalPostId && <span>{t('marketingSocial.detail.externalId', { id: current.externalPostId })}</span>}
            </div>
          )}
          {current?.lastError && <InlineMessage text={`${t('marketingSocial.detail.lastError')}: ${current.lastError}`} tone="error" />}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <SelectField
              label={t('marketingSocial.composer.connection')}
              value={form.connectionId}
              onChange={(v) => setForm({ ...form, connectionId: v })}
              options={[
                { value: '', label: t('marketingSocial.composer.connectionPlaceholder') },
                ...connections.map((c) => ({ value: c.id, label: `${c.displayName} (${t(`marketingSocial.provider.${c.provider}`)})` })),
              ]}
              disabled={!canManage || !editable}
            />
            <InputField label={t('marketingSocial.composer.locale')} value={form.locale} onChange={(v) => setForm({ ...form, locale: v })} disabled={!canManage || !editable} />
          </div>

          <AreaField
            label={t('marketingSocial.composer.text')}
            value={form.text}
            onChange={(v) => setForm({ ...form, text: v })}
            rows={6}
            disabled={!canManage || !editable}
            invalid={over}
            hint={
              limits ? (
                <span data-testid="social-counter">
                  {t(over ? 'marketingSocial.composer.counterOver' : 'marketingSocial.composer.counter', {
                    count: fmtNumber.format(count),
                    limit: fmtNumber.format(limits.maxTextLength),
                  })}
                </span>
              ) : undefined
            }
          />
          {limits?.linkPlacement === 'APPENDED' && (
            <p className="ui-caption">
              {t('marketingSocial.composer.linkAppended')}
            </p>
          )}
          <InputField label={t('marketingSocial.composer.link')} value={form.link} onChange={(v) => setForm({ ...form, link: v })} type="url" disabled={!canManage || !editable} />

          <div className="space-y-2">
            <InputField
              label={t('marketingSocial.composer.media')}
              value={form.mediaDraft}
              onChange={(v) => setForm({ ...form, mediaDraft: v })}
              placeholder={t('marketingSocial.composer.mediaPlaceholder')}
              disabled={!canManage || !editable}
              hint={
                limits ? (
                  <span>
                    {limits.maxMedia === 0
                      ? t('marketingSocial.composer.mediaRule.none')
                      : limits.mediaRequired
                        ? t('marketingSocial.composer.mediaRule.required', { max: limits.maxMedia })
                        : t('marketingSocial.composer.mediaRule.max', { max: limits.maxMedia })}
                  </span>
                ) : undefined
              }
            />
            {canManage && editable && (
              <SecondaryButton
                onClick={() => {
                  const url = form.mediaDraft.trim();
                  if (url) setForm({ ...form, media: [...form.media, url], mediaDraft: '' });
                }}
                disabled={form.mediaDraft.trim() === ''}
              >
                {t('marketingSocial.composer.mediaAdd')}
              </SecondaryButton>
            )}
            <ul className="space-y-1">
              {form.media.map((url, index) => (
                <li key={`${url}-${index}`} className="flex items-center justify-between gap-2 ui-caption">
                  <span className="truncate font-mono">{url}</span>
                  {canManage && editable && <LinkButton onClick={() => setForm({ ...form, media: form.media.filter((_, i) => i !== index) })}>{t('marketingSocial.composer.mediaRemove')}</LinkButton>}
                </li>
              ))}
            </ul>
            {shapeIssues.map((code) => (
              <InlineMessage key={code} text={t(`marketingSocial.shape.${code}`)} tone="error" />
            ))}
          </div>

          <InputField
            label={t('marketingSocial.composer.scheduledAt')}
            type="datetime-local"
            value={form.scheduledAt}
            onChange={(v) => setForm({ ...form, scheduledAt: v })}
            hint={t('marketingSocial.composer.scheduleHint')}
            disabled={!canManage || !editable}
          />
          {form.calendarItemId && (
            <p className="ui-caption">
              {t('marketingSocial.composer.calendarLinked')}{' '}
              <Link href="/pazarlama/takvim" className="pui-link pui-surface">
                {t('marketingSocial.detail.openCalendar')}
              </Link>
            </p>
          )}

          <div className="space-y-1" aria-label={t('marketingSocial.brandCheck.title')}>
            <h4 className="uppercase ui-strong ui-caption">
              {t('marketingSocial.brandCheck.title')}
            </h4>
            {!current ? (
              <p className="ui-caption">
                {t('marketingSocial.brandCheck.pending')}
              </p>
            ) : current.brandCheck.issues.length === 0 ? (
              <p className="ui-caption">
                {t('marketingSocial.brandCheck.clean')}
              </p>
            ) : (
              <IssueList issues={current.brandCheck.issues} />
            )}
          </div>

          {current && (
            <div className="space-y-2 pt-3 ui-rule">
              <h4 className="uppercase ui-strong ui-caption">
                {t('marketingSocial.approval.title')}
              </h4>
              {!current.approval ? (
                <p className="ui-caption">
                  {t('marketingSocial.approval.none')}
                </p>
              ) : (
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={current.approval.status === 'PENDING' ? 'warning' : current.approval.status === 'REJECTED' ? 'danger' : 'success'}>
                      {t(`marketingApprovals.status.${current.approval.status}` as MessageKey)}
                    </Badge>
                    {current.approval.status === 'PENDING' && (
                      <span className="ui-caption">
                        {t('marketingSocial.approval.expires', { date: fmtDate.format(new Date(current.approval.expiresAt)) })}
                      </span>
                    )}
                    <Link href={`/pazarlama/onaylar?id=${encodeURIComponent(current.approval.id)}`} className="pui-link pui-surface ui-caption">
                      {t('marketingSocial.approval.openQueue')}
                    </Link>
                  </div>
                  {current.approval.reasons.length > 0 && (
                    <div className="ui-caption">
                      {t('marketingSocial.approval.reasons')}: {current.approval.reasons.map((r) => t(`marketingApprovals.reason.${r}`)).join(', ')}
                    </div>
                  )}
                  {current.status === 'PENDING_APPROVAL' && (
                    <p className="ui-caption">
                      {t('marketingSocial.approval.waiting')}
                    </p>
                  )}
                  {current.status === 'PENDING_APPROVAL' && isSuperAdmin && (
                    <div className="space-y-2 pt-1">
                      <InputField label={t('marketingSocial.approval.rejectNote')} value={rejectNote} onChange={setRejectNote} />
                      <div className="flex flex-wrap gap-2">
                        <PrimaryButton onClick={() => void decide('approve')} disabled={busy}>
                          {t('marketingSocial.approval.approve')}
                        </PrimaryButton>
                        <SecondaryButton danger onClick={() => void decide('reject')} disabled={busy || rejectNote.trim() === ''}>
                          {t('marketingSocial.approval.reject')}
                        </SecondaryButton>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {canManage && editable && (
              <SecondaryButton onClick={() => void run('save')} disabled={!canSubmit}>
                {t('marketingSocial.composer.saveDraft')}
              </SecondaryButton>
            )}
            {canSend && editable && (
              <PrimaryButton onClick={() => void run('schedule')} disabled={!canSubmit || fromLocalInput(form.scheduledAt) === null}>
                {t('marketingSocial.composer.schedule')}
              </PrimaryButton>
            )}
            {canSend && editable && current?.status !== 'PENDING_APPROVAL' && (
              <SecondaryButton
                onClick={() => window.confirm(t('marketingSocial.composer.confirmPublish')) && void run('publish')}
                disabled={!canSubmit}
              >
                {t('marketingSocial.composer.publishNow')}
              </SecondaryButton>
            )}
            {canSend && current && editable && (
              <SecondaryButton danger onClick={() => void cancelPost()} disabled={busy}>
                {t('marketingSocial.composer.cancelPost')}
              </SecondaryButton>
            )}
            {canManage && current && ['DRAFT', 'CANCELLED', 'FAILED'].includes(current.status) && (
              <LinkButton danger onClick={() => void removePost()} disabled={busy}>
                {t('marketingSocial.composer.delete')}
              </LinkButton>
            )}
            <SecondaryButton
              onClick={() => {
                setForm(null);
                setCurrent(null);
              }}
            >
              {t('marketingSocial.composer.close')}
            </SecondaryButton>
          </div>
        </Section>
      )}
    </div>
  );
}
