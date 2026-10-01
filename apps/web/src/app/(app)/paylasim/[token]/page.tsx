'use client';

import { use, useEffect, useState } from 'react';
import { COMMUNITY_SHARE_TOKEN_PATTERN } from '@platform/shared';
import type { PublicCommunityPostDTO } from '@platform/shared';
import { bffFetch } from '@/lib/session/client';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { LanguageSwitcher } from '@/components/i18n/LanguageSwitcher';
import { PublicShell } from '@/components/common/PublicShell';
import { AnchorButton } from '@/components/ui';

type State = 'loading' | 'ready' | 'invalid';

/**
 * Public, read-only view of a community post whose share link staff turned
 * on (docs/TOPLULUK.md "Paylaşım bağlantısı"). No comments, likes or author;
 * every text is rendered as plain text. A malformed token never reaches the
 * API path.
 */
export default function SharedCommunityPostPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const t = useT();
  const locale = useLocale();
  const [state, setState] = useState<State>('loading');
  const [post, setPost] = useState<PublicCommunityPostDTO | null>(null);

  useEffect(() => {
    if (!COMMUNITY_SHARE_TOKEN_PATTERN.test(token)) {
      setState('invalid');
      return;
    }
    bffFetch<PublicCommunityPostDTO>(`public/community/posts/${token}`)
      .then((res) => {
        setPost(res);
        setState('ready');
      })
      .catch(() => setState('invalid'));
  }, [token]);

  return (
    <PublicShell wide as="article">
      <div className="flex justify-end">
        <LanguageSwitcher mode="cookie" className="pui-input ui-btn-sm" />
      </div>
      {state === 'loading' && <p className="ui-text-muted">{t('common.loading')}</p>}
      {state === 'invalid' && (
        <p className="ui-text-muted" role="alert">
          {t('community.public.invalid')}
        </p>
      )}
      {state === 'ready' && post && (
        <>
          <p className="ui-caption">
            {t('community.public.from', { studio: post.studioName })} - {new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(post.publishedAt))}
          </p>
          <h1 className="ui-title">{post.title}</h1>
          {post.body && <p className="ui-text-muted whitespace-pre-wrap break-words">{post.body}</p>}
          {post.video && (
            <p className="ui-caption">
              {post.video.title} - {t('community.public.videoMembersOnly')}
            </p>
          )}
          {post.attachmentUrl && post.attachmentUrl.startsWith('https://') && (
            <div>
              <AnchorButton href={post.attachmentUrl} target="_blank" rel="noopener noreferrer nofollow" variant="link" tone="theme" size="sm">
                {post.attachmentName || t('community.public.openAttachment')}
              </AnchorButton>
            </div>
          )}
        </>
      )}
    </PublicShell>
  );
}
