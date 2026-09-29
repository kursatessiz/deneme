import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { COMMUNITY_COMMENT_MAX } from '@platform/shared';
import type { CommunityCommentDTO, CommunityFeedItemDTO, CommunityLikeResultDTO } from '@platform/shared';

import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { formatDateTime, useLocale, useT } from '../../../src/i18n';
import { ApiError, apiRequest } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { palette, radii, spacing, typography, useTheme, useThemeFonts } from '../../../src/theme';

const PAGE_SIZE = 20;

/**
 * Community feed (G5b, docs/TOPLULUK.md): the posts the API lets this
 * member see (their access tiers), with likes and comments. Every text is
 * rendered as plain text. A video post opens the library link only when
 * the video itself is unlocked for the member.
 */
export default function ToplulukScreen() {
  const t = useT();
  const { locale } = useLocale();
  const { activeMembership } = useSession();
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const c = theme.colors;
  const studioId = activeMembership?.studioId;
  const base = studioId ? `/studios/${studioId}/community/self` : null;

  const [posts, setPosts] = useState<CommunityFeedItemDTO[] | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [refreshing, setRefreshing] = useState(false);
  const [openPostId, setOpenPostId] = useState<string | null>(null);
  const [comments, setComments] = useState<CommunityCommentDTO[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (nextPage = 1) => {
      if (!base || !studioId) return;
      setError(undefined);
      try {
        const res = await apiRequest<{ items: CommunityFeedItemDTO[] }>(`${base}/feed?page=${nextPage}&pageSize=${PAGE_SIZE}`, { studioId });
        setPosts((prev) => (nextPage === 1 || !prev ? res.items : [...prev, ...res.items]));
        setPage(nextPage);
        setHasMore(res.items.length === PAGE_SIZE);
      } catch {
        setError(t('mCommunity.loadFailed'));
      }
    },
    [base, studioId, t],
  );

  useEffect(() => {
    load(1);
  }, [load]);

  const showError = (err: unknown) => setError(err instanceof ApiError ? err.message : t('mCommunity.actionFailed'));

  const loadComments = async (postId: string) => {
    if (!base || !studioId) return;
    const res = await apiRequest<{ items: CommunityCommentDTO[] }>(`${base}/posts/${postId}/comments`, { studioId });
    setComments(res.items);
  };

  const toggleComments = async (postId: string) => {
    if (openPostId === postId) {
      setOpenPostId(null);
      return;
    }
    setOpenPostId(postId);
    setComments([]);
    setDraft('');
    try {
      await loadComments(postId);
    } catch (err) {
      showError(err);
    }
  };

  const updatePost = (postId: string, patch: Partial<CommunityFeedItemDTO>) =>
    setPosts((prev) => (prev ? prev.map((p) => (p.id === postId ? { ...p, ...patch } : p)) : prev));

  const toggleLike = async (post: CommunityFeedItemDTO) => {
    if (!base || !studioId) return;
    try {
      const res = await apiRequest<CommunityLikeResultDTO>(`${base}/posts/${post.id}/like`, { method: post.likedByMe ? 'DELETE' : 'PUT', studioId });
      updatePost(post.id, { likedByMe: res.liked, likeCount: res.likeCount });
    } catch (err) {
      showError(err);
    }
  };

  const sendComment = async (post: CommunityFeedItemDTO) => {
    if (!base || !studioId || !draft.trim()) return;
    setBusy(true);
    try {
      await apiRequest<CommunityCommentDTO>(`${base}/posts/${post.id}/comments`, { method: 'POST', body: { body: draft.trim() }, studioId });
      setDraft('');
      updatePost(post.id, { commentCount: post.commentCount + 1 });
      await loadComments(post.id);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const deleteComment = async (post: CommunityFeedItemDTO, commentId: string) => {
    if (!base || !studioId) return;
    try {
      await apiRequest<void>(`${base}/comments/${commentId}`, { method: 'DELETE', studioId });
      updatePost(post.id, { commentCount: Math.max(0, post.commentCount - 1) });
      await loadComments(post.id);
    } catch (err) {
      showError(err);
    }
  };

  const openLink = async (url: string | null) => {
    if (!url || !url.startsWith('https://')) return;
    try {
      await Linking.openURL(url);
    } catch {
      setError(t('mCommunity.actionFailed'));
    }
  };

  const card = { backgroundColor: c.surface, borderColor: c.border, borderRadius: theme.family.radii.card };

  return (
    <ScrollView
      style={{ backgroundColor: c.background }}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load(1);
            setRefreshing(false);
          }}
        />
      }
    >
      {!posts && !error ? <ActivityIndicator /> : null}
      {error ? <Text style={[styles.note, { color: palette.danger }]}>{error}</Text> : null}
      {posts && posts.length === 0 ? <Text style={[styles.note, fonts.body, { color: c.textMuted }]}>{t('mCommunity.empty')}</Text> : null}

      {(posts ?? []).map((post) => (
        <View key={post.id} style={[styles.card, card, theme.family.cardBorder && styles.bordered]}>
          <Text style={[styles.meta, fonts.body, { color: c.textMuted }]}>
            {t(`mCommunity.type.${post.type}`)}
            {post.pinned ? ` - ${t('mCommunity.pinned')}` : ''} - {formatDateTime(post.publishedAt, locale)}
          </Text>
          <Text style={[styles.title, fonts.bodyStrong, { color: c.textPrimary }]} accessibilityRole="header">
            {post.title}
          </Text>
          {post.body ? <Text style={[styles.body, fonts.body, { color: c.textSecondary }]}>{post.body}</Text> : null}
          {post.authorName ? <Text style={[styles.meta, fonts.body, { color: c.textMuted }]}>{post.authorName}</Text> : null}

          {post.video ? (
            post.video.isLocked || !post.video.sourceUrl ? (
              <Text style={[styles.meta, fonts.body, { color: c.textMuted }]}>
                {post.video.title} - {t('mCommunity.videoLocked')}
              </Text>
            ) : (
              <PrimaryButton label={t('mCommunity.openVideo')} variant="secondary" onPress={() => openLink(post.video?.sourceUrl ?? null)} />
            )
          ) : null}
          {post.attachmentUrl ? (
            <PrimaryButton label={post.attachmentName || t('mCommunity.openAttachment')} variant="secondary" onPress={() => openLink(post.attachmentUrl)} />
          ) : null}

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: post.likedByMe }}
              accessibilityLabel={post.likedByMe ? t('mCommunity.unlike') : t('mCommunity.like')}
              onPress={() => toggleLike(post)}
              style={styles.action}
            >
              <Text style={[fonts.bodyStrong, { color: post.likedByMe ? c.primary : c.textSecondary }]}>
                {post.likedByMe ? t('mCommunity.unlike') : t('mCommunity.like')} ({t('mCommunity.likes', { count: post.likeCount })})
              </Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => toggleComments(post.id)} style={styles.action}>
              <Text style={[fonts.bodyStrong, { color: c.textSecondary }]}>
                {openPostId === post.id ? t('mCommunity.closeComments') : t('mCommunity.comments', { count: post.commentCount })}
              </Text>
            </Pressable>
          </View>

          {openPostId === post.id ? (
            <View style={styles.comments}>
              {comments.length === 0 ? <Text style={[styles.meta, fonts.body, { color: c.textMuted }]}>{t('mCommunity.noComments')}</Text> : null}
              {comments.map((comment) => (
                <View key={comment.id} style={styles.comment}>
                  <Text style={[styles.meta, fonts.bodyStrong, { color: c.textPrimary }]}>{comment.authorName}</Text>
                  <Text style={[styles.body, fonts.body, { color: c.textSecondary }]}>{comment.body}</Text>
                  {comment.isMine ? (
                    <Pressable accessibilityRole="button" onPress={() => deleteComment(post, comment.id)} style={styles.action}>
                      <Text style={[styles.meta, { color: palette.danger }]}>{t('mCommunity.deleteComment')}</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
              {post.commentsEnabled ? (
                <>
                  <TextInput
                    accessibilityLabel={t('mCommunity.commentPlaceholder')}
                    placeholder={t('mCommunity.commentPlaceholder')}
                    placeholderTextColor={c.textMuted}
                    value={draft}
                    onChangeText={setDraft}
                    maxLength={COMMUNITY_COMMENT_MAX}
                    multiline
                    style={[styles.input, { borderColor: c.border, color: c.textPrimary, backgroundColor: c.background }]}
                  />
                  <PrimaryButton label={t('mCommunity.send')} onPress={() => sendComment(post)} disabled={!draft.trim()} loading={busy} />
                </>
              ) : (
                <Text style={[styles.meta, fonts.body, { color: c.textMuted }]}>{t('mCommunity.commentsOff')}</Text>
              )}
            </View>
          ) : null}
        </View>
      ))}

      {hasMore ? <PrimaryButton label={t('mCommunity.loadMore')} variant="secondary" onPress={() => load(page + 1)} /> : null}
      <View style={styles.spacer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing[4], gap: spacing[3] },
  card: { padding: spacing[4], gap: spacing[2] },
  bordered: { borderWidth: 1 },
  title: { fontSize: typography.size.md },
  body: { fontSize: typography.size.sm },
  meta: { fontSize: typography.size.sm },
  note: { fontSize: typography.size.sm },
  actions: { flexDirection: 'row', gap: spacing[4], flexWrap: 'wrap' },
  action: { minHeight: 44, justifyContent: 'center' },
  comments: { gap: spacing[2] },
  comment: { gap: spacing[1] },
  input: { borderWidth: 1, borderRadius: radii.md, padding: spacing[3], minHeight: 44, fontSize: typography.size.sm },
  spacer: { height: spacing[4] },
});
