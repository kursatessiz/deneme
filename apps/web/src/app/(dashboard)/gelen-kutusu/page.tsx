'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ConversationChannel,
  ConversationDetailDTO,
  ConversationStatus,
  ConversationSummaryDTO,
  SavedReplyDTO,
} from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { PageGuard } from '@/components/common/PageGuard';
import { PermissionButton } from '@/components/common/PermissionButton';
import { Badge } from '@/components/common/Badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/DataState';
import { bffFetch, BffError } from '@/lib/session/client';
import { hasAnyPermission } from '@/lib/nav';
import { aiErrorText } from '@/lib/ai/errors';
import { Input, Select, Textarea } from '@/components/ui';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';

type AssignedFilter = 'any' | 'me' | 'unassigned';

interface ReplyTemplateOption {
  key: string;
  variables: string[];
}

function formatTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}

function ConversationList({
  items,
  selectedId,
  onSelect,
}: {
  items: ConversationSummaryDTO[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  return (
    <ul className="ui-divide" aria-label={t('messaging.inbox.conversations')}>
      {items.map((c) => {
        const active = c.id === selectedId;
        return (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onSelect(c.id)}
              className="ui-pick w-full text-left px-4 py-3 space-y-1"
              aria-current={active ? 'true' : undefined}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate ui-strong">
                  {c.contact.displayName}
                </span>
                <span className="shrink-0 ui-caption">
                  {formatTime(c.lastMessageAt, locale)}
                </span>
              </div>
              <p className="truncate ui-caption">
                {c.lastMessagePreview}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge>{t(`messaging.channel.${c.channel}`)}</Badge>
                {c.status === 'CLOSED' && <Badge>{t('messaging.status.CLOSED')}</Badge>}
                {c.unreadCount > 0 && <Badge tone="info">{t('messaging.inbox.unread', { count: c.unreadCount })}</Badge>}
                {c.assignedName && (
                  <span className="ui-caption">
                    {t('messaging.inbox.assignedTo', { name: c.assignedName })}
                  </span>
                )}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Composer({
  studioId,
  conversation,
  savedReplies,
  onSent,
}: {
  studioId: string;
  conversation: ConversationDetailDTO;
  savedReplies: SavedReplyDTO[];
  onSent: (next: ConversationDetailDTO) => void;
}) {
  const t = useT();
  const [body, setBody] = useState('');
  const [templates, setTemplates] = useState<ReplyTemplateOption[] | null>(null);
  const [templateKey, setTemplateKey] = useState('');
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggested, setSuggested] = useState(false);

  const windowClosed = conversation.channel === 'WHATSAPP' && conversation.whatsappWindowOpen === false;

  useEffect(() => {
    setBody('');
    setTemplateKey('');
    setVariables({});
    setError(null);
    setSuggested(false);
  }, [conversation.id]);

  /** "Cevap öner" (G3b): an AI draft of the next reply from the last messages; the staff member edits and sends it. */
  async function suggest() {
    setSuggesting(true);
    setError(null);
    try {
      const res = await bffFetch<{ text: string }>(`studios/${studioId}/inbox/conversations/${conversation.id}/suggest-reply`, {
        method: 'POST',
        studioId,
        body: {},
      });
      setBody(res.text);
      setSuggested(true);
    } catch (err) {
      setError(aiErrorText(err, t));
    } finally {
      setSuggesting(false);
    }
  }

  useEffect(() => {
    if (!windowClosed || templates) return;
    bffFetch<{ items: ReplyTemplateOption[] }>(`studios/${studioId}/inbox/reply-templates`, { studioId })
      .then((res) => setTemplates(res.items))
      .catch(() => setTemplates([]));
  }, [windowClosed, templates, studioId]);

  const selectedTemplate = templates?.find((tpl) => tpl.key === templateKey) ?? null;

  async function send(payload: { body: string } | { templateKey: string; variables: Record<string, string> }) {
    setBusy(true);
    setError(null);
    try {
      const next = await bffFetch<ConversationDetailDTO>(`studios/${studioId}/inbox/conversations/${conversation.id}/reply`, {
        method: 'POST',
        studioId,
        body: payload,
      });
      setBody('');
      setTemplateKey('');
      setVariables({});
      onSent(next);
    } catch (err) {
      setError(err instanceof BffError ? err.message : t('messaging.inbox.sendError'));
    } finally {
      setBusy(false);
    }
  }

  if (conversation.status === 'CLOSED') return null;

  if (windowClosed) {
    return (
      <div className="p-4 space-y-3 ui-rule">
        <p className="ui-caption">
          {t('messaging.inbox.windowClosed')}
        </p>
        <label className="block space-y-1">
          <span className="ui-strong ui-caption">
            {t('messaging.inbox.templateLabel')}
          </span>
          <Select
            value={templateKey}
            onChange={(e) => {
              setTemplateKey(e.target.value);
              setVariables({});
            }}
          >
            <option value="">{t('messaging.inbox.templatePick')}</option>
            {(templates ?? []).map((tpl) => (
              <option key={tpl.key} value={tpl.key}>
                {tpl.key}
              </option>
            ))}
          </Select>
        </label>
        {selectedTemplate && selectedTemplate.variables.length > 0 && (
          <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <legend className="mb-1 ui-strong ui-caption">
              {t('messaging.inbox.variables')}
            </legend>
            {selectedTemplate.variables.map((name) => (
              <label key={name} className="block space-y-1">
                <span className="ui-caption">{`{${name}}`}</span>
                <Input
                  value={variables[name] ?? ''}
                  onChange={(e) => setVariables({ ...variables, [name]: e.target.value })}
                />
              </label>
            ))}
          </fieldset>
        )}
        {error && (
          <p className="ui-text-error ui-small" role="alert">
            {error}
          </p>
        )}
        <PermissionButton
          required={['inbox.reply']}
          variant="primary"
          disabled={busy || !templateKey}
          onClick={() => send({ templateKey, variables })}
        >
          {t('messaging.inbox.sendTemplate')}
        </PermissionButton>
      </div>
    );
  }

  return (
    <form
      className="p-4 space-y-2 ui-rule"
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim()) void send({ body: body.trim() });
      }}
    >
      {savedReplies.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="ui-strong ui-caption">
            {t('messaging.inbox.savedReplies')}
          </span>
          {savedReplies.map((r) => (
            <Button key={r.id} variant="outline" tone="surface" size="sm" onClick={() => setBody(r.body)}>
              {r.title}
            </Button>
          ))}
        </div>
      )}
      <label className="block">
        <span className="sr-only">{t('messaging.inbox.replyLabel')}</span>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t('messaging.inbox.replyPlaceholder')}
          aria-label={t('messaging.inbox.replyLabel')}
          maxLength={4000}
          rows={3}
        />
      </label>
      {error && (
        <p className="ui-text-error ui-small" role="alert">
          {error}
        </p>
      )}
      {suggested && (
        <p className="ui-caption">
          {t('ai.suggest.hint')}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <PermissionButton required={['ai.use']} onClick={suggest} disabled={busy || suggesting}>
          {suggesting ? t('ai.suggesting') : t('ai.suggestReply')}
        </PermissionButton>
        <PermissionButton required={['inbox.reply']} type="submit" variant="primary" disabled={busy || !body.trim()}>
          {t('messaging.inbox.send')}
        </PermissionButton>
      </div>
    </form>
  );
}

function ConversationPanel({
  studioId,
  conversationId,
  savedReplies,
  onChanged,
}: {
  studioId: string;
  conversationId: string;
  savedReplies: SavedReplyDTO[];
  onChanged: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const { permissions, isOwner } = useDashboardSession();
  const canReply = hasAnyPermission(['inbox.reply'], permissions, isOwner);
  const [detail, setDetail] = useState<ConversationDetailDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    bffFetch<ConversationDetailDTO>(`studios/${studioId}/inbox/conversations/${conversationId}`, { studioId })
      .then((res) => {
        if (!cancelled) {
          setDetail(res);
          onChanged();
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof BffError ? err.message : t('common.error.generic'));
      });
    return () => {
      cancelled = true;
    };
    // onChanged only refreshes the list's unread badge; it must not re-trigger this load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioId, conversationId]);

  async function patch(path: 'assign' | 'status', body: { membershipId: 'me' | null } | { status: ConversationStatus }) {
    setActionError(null);
    try {
      await bffFetch(`studios/${studioId}/inbox/conversations/${conversationId}/${path}`, { method: 'PATCH', studioId, body });
      const next = await bffFetch<ConversationDetailDTO>(`studios/${studioId}/inbox/conversations/${conversationId}`, { studioId });
      setDetail(next);
      onChanged();
    } catch (err) {
      setActionError(err instanceof BffError ? err.message : t('messaging.inbox.statusChangeError'));
    }
  }

  if (error) return <ErrorState message={error} />;
  if (!detail) return <LoadingState />;

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4 ui-rule-b">
        <div className="min-w-0">
          <h3 className="truncate ui-strong">
            {detail.contact.displayName}
          </h3>
          <div className="flex flex-wrap items-center gap-2 mt-1 ui-caption">
            <Badge>{t(`messaging.channel.${detail.channel as ConversationChannel}`)}</Badge>
            <Badge tone={detail.status === 'OPEN' ? 'success' : 'neutral'}>{t(`messaging.status.${detail.status}`)}</Badge>
            {detail.contact.phone && <span>{t('messaging.inbox.contactPhone', { phone: detail.contact.phone })}</span>}
            {detail.contact.email && <span>{t('messaging.inbox.contactEmail', { email: detail.contact.email })}</span>}
            <span>{detail.assignedName ? t('messaging.inbox.assignedTo', { name: detail.assignedName }) : t('messaging.inbox.notAssigned')}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {detail.assignedMembershipId ? (
            <PermissionButton required={['inbox.manage']} onClick={() => patch('assign', { membershipId: null })}>
              {t('messaging.inbox.unassign')}
            </PermissionButton>
          ) : (
            <PermissionButton required={['inbox.manage']} onClick={() => patch('assign', { membershipId: 'me' })}>
              {t('messaging.inbox.assignToMe')}
            </PermissionButton>
          )}
          {detail.status === 'OPEN' ? (
            <PermissionButton required={['inbox.manage']} onClick={() => patch('status', { status: 'CLOSED' })}>
              {t('messaging.inbox.close')}
            </PermissionButton>
          ) : (
            <PermissionButton required={['inbox.manage']} onClick={() => patch('status', { status: 'OPEN' })}>
              {t('messaging.inbox.reopen')}
            </PermissionButton>
          )}
        </div>
      </div>
      {actionError && (
        <p className="px-4 pt-2 ui-text-error ui-small" role="alert">
          {actionError}
        </p>
      )}
      <ol className="flex-1 overflow-y-auto p-4 space-y-3" aria-label={detail.contact.displayName}>
        {detail.messages.map((m) => {
          const outgoing = m.direction === 'OUT';
          return (
            <li key={m.id} className={`flex ${outgoing ? 'justify-end' : 'justify-start'}`}>
              <div
                className="max-w-[80%] px-3 py-2 space-y-1 pui-card"
              >
                <p className="whitespace-pre-wrap break-words">
                  {m.body}
                </p>
                {m.attachments.map((a, i) => (
                  <p key={i} className="ui-caption">
                    {t('messaging.inbox.attachment', { kind: a.fileName ?? a.kind })}
                  </p>
                ))}
                <p className="ui-caption">
                  {[
                    outgoing ? (m.authorName ?? t('messaging.inbox.staff')) : detail.contact.displayName,
                    formatTime(m.createdAt, locale),
                    outgoing ? t(`messaging.messageStatus.${m.status}`) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      {canReply ? (
        <Composer
          studioId={studioId}
          conversation={detail}
          savedReplies={savedReplies}
          onSent={(next) => {
            setDetail(next);
            onChanged();
          }}
        />
      ) : (
        <p className="p-4 ui-caption ui-rule">
          {t('messaging.inbox.readOnly')}
        </p>
      )}
    </div>
  );
}

function SavedRepliesManager({ studioId, items, onChanged }: { studioId: string; items: SavedReplyDTO[]; onChanged: () => void }) {
  const t = useT();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await bffFetch(`studios/${studioId}/inbox/saved-replies`, { method: 'POST', studioId, body: { title: title.trim(), body: body.trim() } });
      setTitle('');
      setBody('');
      onChanged();
    } catch (err) {
      setError(err instanceof BffError ? err.message : t('common.error.generic'));
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await bffFetch(`studios/${studioId}/inbox/saved-replies/${id}`, { method: 'DELETE', studioId });
      onChanged();
    } catch (err) {
      setError(err instanceof BffError ? err.message : t('common.error.generic'));
    }
  }

  return (
    <details className="p-4 pui-card">
      <summary className="cursor-pointer ui-strong">
        {t('messaging.inbox.savedReplies')}
      </summary>
      <div className="mt-3 space-y-3">
        {items.length === 0 ? (
          <p className="ui-caption">
            {t('messaging.inbox.savedReplies.empty')}
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="ui-strong">
                    {r.title}
                  </p>
                  <p className="whitespace-pre-wrap ui-caption">
                    {r.body}
                  </p>
                </div>
                <PermissionButton required={['inbox.manage']} variant="danger" onClick={() => remove(r.id)}>
                  {t('messaging.inbox.savedReplies.delete')}
                </PermissionButton>
              </li>
            ))}
          </ul>
        )}
        <PermissionGateForm>
          <form onSubmit={create} className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
            <label className="block space-y-1">
              <span className="ui-caption">
                {t('messaging.inbox.savedReplies.titleLabel')}
              </span>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
            </label>
            <label className="block space-y-1 sm:col-span-2">
              <span className="ui-caption">
                {t('messaging.inbox.savedReplies.bodyLabel')}
              </span>
              <Input value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} />
            </label>
            <div className="sm:col-span-3 flex justify-end">
              <PermissionButton required={['inbox.manage']} type="submit" variant="primary" disabled={!title.trim() || !body.trim()}>
                {t('messaging.inbox.savedReplies.save')}
              </PermissionButton>
            </div>
          </form>
        </PermissionGateForm>
        {error && (
          <p className="ui-text-error ui-small" role="alert">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}

/** Renders the saved-reply form only for inbox.manage. */
function PermissionGateForm({ children }: { children: React.ReactNode }) {
  const { permissions, isOwner } = useDashboardSession();
  if (!hasAnyPermission(['inbox.manage'], permissions, isOwner)) return null;
  return <>{children}</>;
}

function Inbox() {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const [status, setStatus] = useState<ConversationStatus | ''>('OPEN');
  const [assigned, setAssigned] = useState<AssignedFilter>('any');
  const [channel, setChannel] = useState<ConversationChannel | ''>('');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<ConversationSummaryDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [savedReplies, setSavedReplies] = useState<SavedReplyDTO[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [savedKey, setSavedKey] = useState(0);

  const query = useMemo(() => {
    const params = new URLSearchParams({ assigned, take: '50' });
    if (status) params.set('status', status);
    if (channel) params.set('channel', channel);
    if (search.trim()) params.set('search', search.trim());
    return params.toString();
  }, [status, assigned, channel, search]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    bffFetch<{ items: ConversationSummaryDTO[] }>(`studios/${activeStudioId}/inbox/conversations?${query}`, { studioId: activeStudioId })
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof BffError ? err.message : t('common.error.generic'));
      });
    return () => {
      cancelled = true;
    };
  }, [activeStudioId, query, reloadKey, t]);

  useEffect(() => {
    bffFetch<{ items: SavedReplyDTO[] }>(`studios/${activeStudioId}/inbox/saved-replies`, { studioId: activeStudioId })
      .then((res) => setSavedReplies(res.items))
      .catch(() => setSavedReplies([]));
  }, [activeStudioId, savedKey]);

  const refreshList = useCallback(() => setReloadKey((k) => k + 1), []);

  return (
    <div className="space-y-4">
      <PageHeader title={t('messaging.inbox.title')} description={t('messaging.inbox.subtitle')} />

      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="block ui-caption">
            {t('messaging.inbox.filter.status')}
          </span>
          <Select value={status} onChange={(e) => setStatus(e.target.value as ConversationStatus | '')}>
            <option value="OPEN">{t('messaging.status.OPEN')}</option>
            <option value="CLOSED">{t('messaging.status.CLOSED')}</option>
            <option value="">{t('messaging.inbox.filter.all')}</option>
          </Select>
        </label>
        <label className="space-y-1">
          <span className="block ui-caption">
            {t('messaging.inbox.filter.assigned')}
          </span>
          <Select value={assigned} onChange={(e) => setAssigned(e.target.value as AssignedFilter)}>
            <option value="any">{t('messaging.inbox.filter.anyone')}</option>
            <option value="me">{t('messaging.inbox.filter.mine')}</option>
            <option value="unassigned">{t('messaging.inbox.filter.unassigned')}</option>
          </Select>
        </label>
        <label className="space-y-1">
          <span className="block ui-caption">
            {t('messaging.inbox.filter.channel')}
          </span>
          <Select value={channel} onChange={(e) => setChannel(e.target.value as ConversationChannel | '')}>
            <option value="">{t('messaging.inbox.filter.anyChannel')}</option>
            {(['WHATSAPP', 'SMS', 'EMAIL', 'IN_APP'] as const).map((c) => (
              <option key={c} value={c}>
                {t(`messaging.channel.${c}`)}
              </option>
            ))}
          </Select>
        </label>
        <label className="space-y-1 flex-1 min-w-[180px]">
          <span className="block ui-caption">
            {t('messaging.inbox.search')}
          </span>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} />
        </label>
      </div>

      <div
        className="pui-card grid grid-cols-1 lg:grid-cols-[minmax(260px,1fr)_2fr] overflow-hidden min-h-[480px]"
      >
        <div className="ui-split-start overflow-y-auto max-h-[640px]">
          {error && <ErrorState message={error} />}
          {!error && items === null && <LoadingState />}
          {!error && items !== null && items.length === 0 && <EmptyState title={t('messaging.inbox.empty')} />}
          {!error && items !== null && items.length > 0 && <ConversationList items={items} selectedId={selectedId} onSelect={setSelectedId} />}
        </div>
        <div className="min-h-[480px]">
          {selectedId ? (
            <ConversationPanel studioId={activeStudioId} conversationId={selectedId} savedReplies={savedReplies} onChanged={refreshList} />
          ) : (
            <div className="h-full flex items-center justify-center p-8 ui-text-muted">
              {t('messaging.inbox.selectConversation')}
            </div>
          )}
        </div>
      </div>

      <SavedRepliesManager studioId={activeStudioId} items={savedReplies} onChanged={() => setSavedKey((k) => k + 1)} />
    </div>
  );
}

export default function InboxPage() {
  return (
    <PageGuard required={['inbox.view']}>
      <Inbox />
    </PageGuard>
  );
}
