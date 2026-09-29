'use client';

import { use, useEffect, useState } from 'react';
import { COMMUNITY_SHARE_TOKEN_PATTERN } from '@platform/shared';
import type { PublicCommunityPostDTO } from '@platform/shared';
import { bffFetch } from '@/lib/session/client';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { LanguageSwitcher } from '@/components/i18n/LanguageSwitcher';

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
    <main className="min-h-screen flex justify-center px-4 py-12" style={{ backgroundColor: 'var(--color-background)' }}>
      <article
        className="w-full max-w-2xl p-8 border space-y-4 h-fit"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-card)' }}
      >
        <div className="flex justify-end">
          <LanguageSwitcher mode="cookie" />
        </div>
        {state === 'loading' && (
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {t('common.loading')}
          </p>
        )}
        {state === 'invalid' && (
          <p className="text-sm" role="alert" style={{ color: 'var(--color-text-secondary)' }}>
            {t('community.public.invalid')}
          </p>
        )}
        {state === 'ready' && post && (
          <>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {t('community.public.from', { studio: post.studioName })} - {new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(post.publishedAt))}
            </p>
            <h1 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
              {post.title}
            </h1>
            {post.body && (
              <p className="text-sm whitespace-pre-wrap break-words" style={{ color: 'var(--color-text-secondary)' }}>
                {post.body}
              </p>
            )}
            {post.video && (
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                {post.video.title} - {t('community.public.videoMembersOnly')}
              </p>
            )}
            {post.attachmentUrl && post.attachmentUrl.startsWith('https://') && (
              <a
                href={post.attachmentUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-block text-sm font-medium underline"
                style={{ color: 'var(--color-primary)' }}
              >
                {post.attachmentName || t('community.public.openAttachment')}
              </a>
            )}
          </>
        )}
      </article>
    </main>
  );
}
