'use client';

import { useState } from 'react';
import { COMMUNITY_POST_STATUSES, COMMUNITY_POST_TYPES } from '@platform/shared';
import type { AccessTierDTO, CommunityCommentDTO, CommunityPostDTO, CommunityPostStatus, CommunityPostType, CommunityShareResultDTO, VideoContentDTO } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { PageGuard } from '@/components/common/PageGuard';
import { PermissionButton } from '@/components/common/PermissionButton';
import { Badge } from '@/components/common/Badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/DataState';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch } from '@/lib/session/client';
import { PageHeader, useDateFormat } from '@/components/growth/ui';
import { Card, Checkbox, FieldGroup, Input, List, ListItem, Select, Textarea } from '@/components/ui';
import { InlineMessage, PrimaryButton, SecondaryButton, Section, TextField, Toggle } from '@/components/settings/ui';
import { communityErrorMessage, shareUrl } from '@/components/community/labels';

interface EditorState {
  type: CommunityPostType;
  title: string;
  body: string;
  videoContentId: string;
  attachmentUrl: string;
  attachmentName: string;
  pinned: boolean;
  commentsEnabled: boolean;
  tierIds: string[];
}

const EMPTY_EDITOR: EditorState = {
  type: 'POST',
  title: '',
  body: '',
  videoContentId: '',
  attachmentUrl: '',
  attachmentName: '',
  pinned: false,
  commentsEnabled: true,
  tierIds: [],
};

function editorFrom(post: CommunityPostDTO): EditorState {
  return {
    type: post.type,
    title: post.title,
    body: post.body,
    videoContentId: post.video?.id ?? '',
    attachmentUrl: post.attachmentUrl ?? '',
    attachmentName: post.attachmentName ?? '',
    pinned: post.pinned,
    commentsEnabled: post.commentsEnabled,
    tierIds: post.tiers.map((tier) => tier.id),
  };
}

function PostEditor({ post, tiers, onDone }: { post: CommunityPostDTO | null; tiers: AccessTierDTO[]; onDone: () => void }) {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const [form, setForm] = useState<EditorState>(post ? editorFrom(post) : EMPTY_EDITOR);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videos = useBff<VideoContentDTO[]>(form.type === 'VIDEO' ? `video/content/studio/${activeStudioId}` : null, activeStudioId);

  const save = async () => {
    setBusy(true);
    setError(null);
    const body = {
      type: form.type,
      title: form.title,
      body: form.body,
      videoContentId: form.type === 'VIDEO' && form.videoContentId ? form.videoContentId : null,
      attachmentUrl: form.attachmentUrl.trim() ? form.attachmentUrl.trim() : null,
      attachmentName: form.attachmentName.trim() ? form.attachmentName.trim() : null,
      pinned: form.pinned,
      commentsEnabled: form.commentsEnabled,
      tierIds: form.tierIds,
    };
    try {
      if (post) {
        await bffFetch(`studios/${activeStudioId}/community/posts/${post.id}`, { method: 'PATCH', studioId: activeStudioId, body });
      } else {
        await bffFetch(`studios/${activeStudioId}/community/posts`, { method: 'POST', studioId: activeStudioId, body });
      }
      onDone();
    } catch (err) {
      setError(communityErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const toggleTier = (id: string) =>
    setForm((f) => ({ ...f, tierIds: f.tierIds.includes(id) ? f.tierIds.filter((x) => x !== id) : [...f.tierIds, id] }));

  return (
    <Section title={post ? t('community.editor.editTitle') : t('community.editor.newTitle')}>
      <div className="space-y-3 max-w-2xl">
        <FieldGroup label={t('community.editor.type')}>
          <Select id="community-post-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as CommunityPostType })}>
            {COMMUNITY_POST_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`community.type.${type}`)}
              </option>
            ))}
          </Select>
        </FieldGroup>
        <TextField label={t('community.editor.title')} value={form.title} onChange={(v) => setForm({ ...form, title: v })} />
        <FieldGroup label={t('community.editor.body')}>
          <Textarea id="community-post-body" rows={5} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        </FieldGroup>
        {form.type === 'VIDEO' && (
          <div className="grid gap-1">
            {videos.forbidden || videos.error ? (
              <>
                <span className="ui-caption">{t('community.editor.video')}</span>
                <InlineMessage text={t('community.editor.videoUnavailable')} tone="error" />
              </>
            ) : (
              <FieldGroup label={t('community.editor.video')}>
                <Select id="community-post-video" value={form.videoContentId} onChange={(e) => setForm({ ...form, videoContentId: e.target.value })}>
                  <option value="">{t('community.editor.videoNone')}</option>
                  {(videos.data ?? []).map((video) => (
                    <option key={video.id} value={video.id}>
                      {video.title}
                    </option>
                  ))}
                </Select>
              </FieldGroup>
            )}
          </div>
        )}
        {(form.type === 'FILE' || form.attachmentUrl) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TextField label={t('community.editor.attachmentUrl')} value={form.attachmentUrl} onChange={(v) => setForm({ ...form, attachmentUrl: v })} />
            <TextField label={t('community.editor.attachmentName')} value={form.attachmentName} onChange={(v) => setForm({ ...form, attachmentName: v })} />
          </div>
        )}
        <fieldset className="grid gap-2">
          <legend className="ui-caption">{t('community.editor.tiers')}</legend>
          {tiers.length === 0 ? (
            <InlineMessage text={t('community.editor.noTiers')} />
          ) : (
            <div className="flex flex-wrap gap-3">
              {tiers.map((tier) => (
                <Checkbox key={tier.id} checked={form.tierIds.includes(tier.id)} onChange={() => toggleTier(tier.id)} label={tier.name} />
              ))}
            </div>
          )}
          <InlineMessage text={t('community.editor.tiersHint')} />
        </fieldset>
        <Toggle label={t('community.editor.pinned')} checked={form.pinned} onChange={(v) => setForm({ ...form, pinned: v })} />
        <Toggle label={t('community.editor.commentsEnabled')} checked={form.commentsEnabled} onChange={(v) => setForm({ ...form, commentsEnabled: v })} />
        {error && <InlineMessage text={error} tone="error" />}
        <div className="flex gap-2">
          <PrimaryButton onClick={save} disabled={busy || !form.title.trim()}>
            {t('community.editor.save')}
          </PrimaryButton>
          <SecondaryButton onClick={onDone} disabled={busy}>
            {t('community.editor.cancel')}
          </SecondaryButton>
        </div>
      </div>
    </Section>
  );
}

function CommentsPanel({ postId }: { postId: string }) {
  const t = useT();
  const fmt = useDateFormat();
  const { activeStudioId } = useDashboardSession();
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { data, loading } = useBff<{ items: CommunityCommentDTO[] }>(`studios/${activeStudioId}/community/posts/${postId}/comments`, activeStudioId, refreshKey);
  const base = `studios/${activeStudioId}/community/comments`;

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError(communityErrorMessage(err, t));
    }
  };

  if (loading && !data) return <LoadingState />;
  const comments = data?.items ?? [];
  return (
    <div className="space-y-2 pt-2" data-testid="community-comments">
      <h4 className="ui-caption ui-strong">{t('community.comments.title')}</h4>
      {comments.length === 0 && <InlineMessage text={t('community.comments.empty')} />}
      <ul className="grid gap-2">
        {comments.map((comment) => (
          <li key={comment.id} className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="ui-caption">
                {comment.authorName} - {fmt.dateTime(comment.createdAt)} {comment.isHidden && <Badge tone="warning">{t('community.comments.hidden')}</Badge>}
              </p>
              {/* Plain text only: React escapes it, and it is never set as HTML. */}
              <p className="whitespace-pre-wrap break-words">{comment.body}</p>
            </div>
            <div className="flex gap-2">
              <PermissionButton
                required={['community.moderate']}
                onClick={() => run(() => bffFetch(`${base}/${comment.id}/${comment.isHidden ? 'unhide' : 'hide'}`, { method: 'POST', studioId: activeStudioId }))}
              >
                {comment.isHidden ? t('community.comments.unhide') : t('community.comments.hide')}
              </PermissionButton>
              <PermissionButton
                required={['community.moderate']}
                variant="danger"
                onClick={() => run(() => bffFetch(`${base}/${comment.id}`, { method: 'DELETE', studioId: activeStudioId }))}
              >
                {t('community.comments.delete')}
              </PermissionButton>
            </div>
          </li>
        ))}
      </ul>
      {error && <InlineMessage text={error} tone="error" />}
    </div>
  );
}

function PostItem({ post, onChanged, onEdit }: { post: CommunityPostDTO; onChanged: () => void; onEdit: (post: CommunityPostDTO) => void }) {
  const t = useT();
  const fmt = useDateFormat();
  const { activeStudioId } = useDashboardSession();
  const [showComments, setShowComments] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `studios/${activeStudioId}/community/posts/${post.id}`;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError(communityErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const statusTone = post.status === 'PUBLISHED' ? 'success' : post.status === 'ARCHIVED' ? 'neutral' : 'info';

  return (
    <ListItem className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="ui-strong">{post.title}</p>
        <Badge>{t(`community.type.${post.type}`)}</Badge>
        <Badge tone={statusTone}>{t(`community.status.${post.status}`)}</Badge>
        {post.pinned && <Badge tone="warning">{t('community.pinned')}</Badge>}
        {!post.commentsEnabled && <Badge>{t('community.commentsOff')}</Badge>}
      </div>
      {post.body && (
        <p className="ui-text-muted whitespace-pre-wrap break-words line-clamp-3">{post.body}</p>
      )}
      <p className="ui-caption">
        {post.tiers.length === 0 ? t('community.audience.all') : t('community.audience.tiers', { tiers: post.tiers.map((tier) => tier.name).join(', ') })}
        {' - '}
        {t('community.stats', { likes: fmt.number(post.likeCount), comments: fmt.number(post.commentCount) })}
        {post.hiddenCommentCount > 0 && ` - ${t('community.stats.hidden', { count: fmt.number(post.hiddenCommentCount) })}`}
        {post.authorName && ` - ${t('community.author', { name: post.authorName })}`}
        {post.publishedAt && ` - ${t('community.publishedAt', { date: fmt.date(post.publishedAt) })}`}
      </p>
      {post.shareToken && (
        <div className="max-w-xl">
          <FieldGroup label={t('community.share.label')} hint={t('community.share.hint')}>
            <Input id={`community-share-${post.id}`} readOnly value={shareUrl(post.shareToken)} onFocus={(e) => e.currentTarget.select()} />
          </FieldGroup>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <PermissionButton required={['community.manage']} disabled={busy} onClick={() => onEdit(post)}>
          {t('community.action.edit')}
        </PermissionButton>
        {post.status !== 'PUBLISHED' && (
          <PermissionButton required={['community.manage']} variant="primary" disabled={busy} onClick={() => run(() => bffFetch(`${base}/publish`, { method: 'POST', studioId: activeStudioId }))}>
            {t('community.action.publish')}
          </PermissionButton>
        )}
        {post.status === 'PUBLISHED' && (
          <PermissionButton required={['community.manage']} disabled={busy} onClick={() => run(() => bffFetch(`${base}/archive`, { method: 'POST', studioId: activeStudioId }))}>
            {t('community.action.archive')}
          </PermissionButton>
        )}
        <PermissionButton
          required={['community.manage']}
          disabled={busy}
          onClick={() => run(() => bffFetch(base, { method: 'PATCH', studioId: activeStudioId, body: { pinned: !post.pinned } }))}
        >
          {post.pinned ? t('community.action.unpin') : t('community.action.pin')}
        </PermissionButton>
        {post.status === 'PUBLISHED' && (
          <PermissionButton
            required={['community.manage']}
            disabled={busy}
            onClick={() =>
              run(() => bffFetch<CommunityShareResultDTO>(`${base}/share`, { method: post.shareToken ? 'DELETE' : 'POST', studioId: activeStudioId }))
            }
          >
            {post.shareToken ? t('community.action.shareOff') : t('community.action.shareOn')}
          </PermissionButton>
        )}
        <PermissionButton variant="ghost" onClick={() => setShowComments((v) => !v)}>
          {showComments ? t('community.action.closeComments') : t('community.action.showComments')}
        </PermissionButton>
      </div>
      {error && <InlineMessage text={error} tone="error" />}
      {showComments && <CommentsPanel postId={post.id} />}
    </ListItem>
  );
}

function CommunityView() {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const [status, setStatus] = useState<CommunityPostStatus | ''>('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [editing, setEditing] = useState<CommunityPostDTO | 'new' | null>(null);
  const path = activeStudioId ? `studios/${activeStudioId}/community/posts${status ? `?status=${status}` : ''}` : null;
  const { data, loading, error, forbidden } = useBff<{ items: CommunityPostDTO[] }>(path, activeStudioId, refreshKey);
  const tiers = useBff<{ items: AccessTierDTO[] }>(activeStudioId ? `studios/${activeStudioId}/community/tiers` : null, activeStudioId, refreshKey);

  if (forbidden) return <ErrorState message={t('community.forbidden')} />;
  const refresh = () => setRefreshKey((k) => k + 1);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('community.title')}
        subtitle={t('community.subtitle')}
        actions={
          <PermissionButton required={['community.manage']} variant="primary" onClick={() => setEditing('new')}>
            {t('community.new')}
          </PermissionButton>
        }
      />
      {editing && (
        <PostEditor
          key={editing === 'new' ? 'new' : editing.id}
          post={editing === 'new' ? null : editing}
          tiers={tiers.data?.items ?? []}
          onDone={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
      <div className="max-w-xs">
        <FieldGroup label={t('community.filter.status')}>
          <Select id="community-status" value={status} onChange={(e) => setStatus(e.target.value as CommunityPostStatus | '')}>
            <option value="">{t('community.filter.all')}</option>
            {COMMUNITY_POST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`community.status.${s}`)}
              </option>
            ))}
          </Select>
        </FieldGroup>
      </div>
      {loading && !data && <LoadingState />}
      {error && <ErrorState message={error} />}
      {data && data.items.length === 0 && !loading && <EmptyState title={t('community.empty')} description={t('community.emptyHint')} />}
      {data && data.items.length > 0 && (
        <Card>
          <List className="ui-divide" data-testid="community-posts">
            {data.items.map((post) => (
              <PostItem key={post.id} post={post} onChanged={refresh} onEdit={(p) => setEditing(p)} />
            ))}
          </List>
        </Card>
      )}
    </div>
  );
}

export default function CommunityPage() {
  return (
    <PageGuard required={['community.view', 'community.manage']}>
      <CommunityView />
    </PageGuard>
  );
}
