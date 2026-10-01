'use client';

import { useEffect, useState } from 'react';
import {
  ARTICLE_ERROR_CODES,
  ARTICLE_PAGE_SIZE_DEFAULT,
  ARTICLE_STATUSES,
  articlePath,
  articleTagLabel,
  type ArticleDTO,
  type ArticleStatus,
  type ArticleTagDTO,
  type PaginatedDTO,
  type Translate,
} from '@platform/shared';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, ErrorState } from '@/components/common/DataState';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { InlineMessage, PrimaryButton, SecondaryButton, Section, TextField } from '@/components/settings/ui';
import { Badge, ChipButton, FieldGroup, Input, Select, Table, Tabs, Tbody, Td, Th, Thead, Tr, Textarea } from '@/components/ui';

/**
 * Blog articles of a site (S2b, docs/SAYFA_MOTORU.md "Yazılar / blog"), shared by the super admin "Web sitesi"
 * screen (the platform site, through the platform studio) and the tenant "Web sitem" settings page
 * (permission `sites.articles.manage`). Field-based form per locale; the body is plain text with the small
 * markup subset described in the hint, never HTML.
 */

interface LocaleDraft {
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  seoTitle: string;
  seoDescription: string;
  ogImageUrl: string;
}

interface ArticleDraft {
  id: string | null;
  status: ArticleStatus;
  authorName: string;
  coverImageUrl: string;
  tagIds: string[];
  locales: Record<string, LocaleDraft>;
}

const EMPTY_LOCALE: LocaleDraft = { slug: '', title: '', excerpt: '', body: '', seoTitle: '', seoDescription: '', ogImageUrl: '' };

function errorText(err: unknown, t: Translate, fallbackKey: string): string {
  if (err instanceof BffError) {
    if (err.code && (ARTICLE_ERROR_CODES as readonly string[]).includes(err.code)) return t(`articles.error.${err.code}`);
    if (err.status === 400) return t('articles.error.validation');
  }
  return t(fallbackKey);
}

function toDraft(article: ArticleDTO): ArticleDraft {
  const locales: Record<string, LocaleDraft> = {};
  for (const l of article.locales) {
    locales[l.locale] = {
      slug: l.slug,
      title: l.title,
      excerpt: l.excerpt ?? '',
      body: l.body,
      seoTitle: l.seoTitle ?? '',
      seoDescription: l.seoDescription ?? '',
      ogImageUrl: l.ogImageUrl ?? '',
    };
  }
  return { id: article.id, status: article.status, authorName: article.authorName, coverImageUrl: article.coverImageUrl ?? '', tagIds: article.tagIds, locales };
}

/** A locale is part of the article once any of its required fields is filled in. */
function filledLocales(draft: ArticleDraft): Array<[string, LocaleDraft]> {
  return Object.entries(draft.locales).filter(([, l]) => l.slug.trim() || l.title.trim() || l.body.trim());
}

function toPayload(draft: ArticleDraft) {
  return {
    authorName: draft.authorName.trim(),
    coverImageUrl: draft.coverImageUrl.trim() || null,
    tagIds: draft.tagIds,
    locales: filledLocales(draft).map(([locale, l]) => ({
      locale,
      slug: l.slug.trim(),
      title: l.title.trim(),
      excerpt: l.excerpt.trim() || null,
      body: l.body,
      seoTitle: l.seoTitle.trim() || null,
      seoDescription: l.seoDescription.trim() || null,
      ogImageUrl: l.ogImageUrl.trim() || null,
    })),
  };
}

function statusTone(status: ArticleStatus): 'theme' | 'muted' | 'warn' {
  return status === 'PUBLISHED' ? 'theme' : status === 'ARCHIVED' ? 'warn' : 'muted';
}

export function ArticleEditor({ studioId, variant }: { studioId: string; variant: 'tenant' | 'platform' }) {
  const t = useT();
  const uiLocale = useLocale();
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);

  const [siteLocales, setSiteLocales] = useState<{ defaultLocale: string; enabledLocales: string[] } | null>(null);
  const [tags, setTags] = useState<ArticleTagDTO[]>([]);
  const [list, setList] = useState<PaginatedDTO<ArticleDTO> | null>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<ArticleStatus | ''>('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ArticleDraft | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    const query = new URLSearchParams({ page: String(page), pageSize: String(ARTICLE_PAGE_SIZE_DEFAULT), ...(statusFilter ? { status: statusFilter } : {}) });
    Promise.all([
      bffFetch<{ defaultLocale: string; enabledLocales: string[] }>(`sites/studio/${studioId}`, { studioId }),
      bffFetch<{ items: ArticleTagDTO[] }>(`sites/studio/${studioId}/article-tags`, { studioId }),
      bffFetch<PaginatedDTO<ArticleDTO>>(`sites/studio/${studioId}/articles?${query.toString()}`, { studioId }),
    ])
      .then(([site, tagRes, articles]) => {
        if (cancelled) return;
        setSiteLocales({ defaultLocale: site.defaultLocale, enabledLocales: site.enabledLocales });
        setTags(tagRes.items);
        setList(articles);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(errorText(err, t, 'articles.editor.loadFailed'));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioId, refreshKey, page, statusFilter]);

  if (loadError) return <ErrorState message={loadError} />;
  if (!siteLocales || !list) return <LoadingState />;

  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const titleOf = (article: ArticleDTO) =>
    (article.locales.find((l) => l.locale === siteLocales.defaultLocale) ?? article.locales[0])?.title || t('articles.editor.untitled');
  const dateFormat = new Intl.DateTimeFormat(uiLocale, { dateStyle: 'medium' });

  const startNew = () => setDraft({ id: null, status: 'DRAFT', authorName: '', coverImageUrl: '', tagIds: [], locales: { [siteLocales.defaultLocale]: { ...EMPTY_LOCALE } } });

  return (
    <div className="grid gap-6">
      <Section title={t('articles.editor.title')} description={t('articles.editor.description')}>
        <div className="flex flex-wrap items-end gap-3">
          <PrimaryButton onClick={startNew}>{t('articles.editor.new')}</PrimaryButton>
          <FieldGroup label={t('articles.editor.filter.label')}>
            <Select
              value={statusFilter}
              onChange={(e) => {
                setPage(1);
                setStatusFilter(e.target.value as ArticleStatus | '');
              }}
              className="w-auto"
            >
              <option value="">{t('articles.editor.filter.all')}</option>
              {ARTICLE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`articles.editor.status.${s}`)}
                </option>
              ))}
            </Select>
          </FieldGroup>
        </div>

        {list.items.length === 0 ? (
          <p className="ui-text-muted">{t('articles.editor.empty')}</p>
        ) : (
          <Table hoverable data-testid="article-list">
            <Thead>
              <Tr>
                <Th>{t('articles.editor.column.title')}</Th>
                <Th>{t('articles.editor.column.status')}</Th>
                <Th>{t('articles.editor.column.locales')}</Th>
                <Th>{t('articles.editor.column.publishedAt')}</Th>
                <Th>
                  <span className="sr-only">{t('articles.editor.edit')}</span>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {list.items.map((article) => (
                <Tr key={article.id}>
                  <Td>{titleOf(article)}</Td>
                  <Td>
                    <Badge tone={statusTone(article.status)}>{t(`articles.editor.status.${article.status}`)}</Badge>
                  </Td>
                  <Td>{article.locales.map((l) => l.locale).join(', ')}</Td>
                  <Td>{article.publishedAt ? dateFormat.format(new Date(article.publishedAt)) : ''}</Td>
                  <Td>
                    <SecondaryButton onClick={() => setDraft(toDraft(article))}>{t('articles.editor.edit')}</SecondaryButton>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}

        {pages > 1 && (
          <div className="flex items-center gap-3">
            <SecondaryButton disabled={page <= 1} onClick={() => setPage(page - 1)}>
              {t('articles.editor.previous')}
            </SecondaryButton>
            <span className="ui-caption">{t('articles.editor.pageOf', { page, pages })}</span>
            <SecondaryButton disabled={page >= pages} onClick={() => setPage(page + 1)}>
              {t('articles.editor.next')}
            </SecondaryButton>
          </div>
        )}
      </Section>

      {draft && (
        <ArticleForm
          key={draft.id ?? 'new'}
          studioId={studioId}
          variant={variant}
          initial={draft}
          tags={tags}
          siteLocales={siteLocales}
          onClose={() => setDraft(null)}
          onSaved={(article) => {
            setDraft(article ? toDraft(article) : null);
            refresh();
          }}
        />
      )}

      <TagManager studioId={studioId} tags={tags} locales={siteLocales.enabledLocales} defaultLocale={siteLocales.defaultLocale} onChanged={refresh} />
    </div>
  );
}

function ArticleForm({
  studioId,
  variant,
  initial,
  tags,
  siteLocales,
  onClose,
  onSaved,
}: {
  studioId: string;
  variant: 'tenant' | 'platform';
  initial: ArticleDraft;
  tags: ArticleTagDTO[];
  siteLocales: { defaultLocale: string; enabledLocales: string[] };
  onClose: () => void;
  onSaved: (article: ArticleDTO | null) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<ArticleDraft>(initial);
  const allLocales = Array.from(new Set([...siteLocales.enabledLocales, ...Object.keys(initial.locales)]));
  const [activeLocale, setActiveLocale] = useState(Object.keys(initial.locales)[0] ?? siteLocales.defaultLocale);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const current = draft.locales[activeLocale] ?? EMPTY_LOCALE;
  const setLocaleField = (field: keyof LocaleDraft, value: string) =>
    setDraft({ ...draft, locales: { ...draft.locales, [activeLocale]: { ...current, [field]: value } } });

  const run = async (action: () => Promise<ArticleDTO | null>, okKey: string) => {
    setMessage(null);
    setBusy(true);
    try {
      const article = await action();
      setMessage({ text: t(okKey), ok: true });
      if (article) setDraft(toDraft(article));
      onSaved(article);
    } catch (err) {
      setMessage({ text: errorText(err, t, 'articles.form.saveFailed'), ok: false });
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const payload = toPayload(draft);
    const incomplete = payload.locales.length === 0 || payload.locales.some((l) => !l.slug || !l.title || !l.body.trim());
    if (!payload.authorName || incomplete) {
      setMessage({ text: t('articles.form.required'), ok: false });
      return;
    }
    return run(
      () =>
        draft.id
          ? bffFetch<ArticleDTO>(`sites/studio/${studioId}/articles/${draft.id}`, { method: 'PATCH', studioId, body: payload })
          : bffFetch<ArticleDTO>(`sites/studio/${studioId}/articles`, { method: 'POST', studioId, body: payload }),
      'articles.form.saved',
    );
  };

  const transition = (path: 'publish' | 'archive', okKey: string) =>
    run(() => bffFetch<ArticleDTO>(`sites/studio/${studioId}/articles/${draft.id}/${path}`, { method: 'POST', studioId }), okKey);

  const remove = () =>
    run(async () => {
      await bffFetch(`sites/studio/${studioId}/articles/${draft.id}`, { method: 'DELETE', studioId });
      return null;
    }, 'articles.form.deleted');

  const removeLocale = () => {
    const rest = { ...draft.locales };
    delete rest[activeLocale];
    setDraft({ ...draft, locales: rest });
  };

  const tabs = allLocales.map((locale) => {
    const l = draft.locales[locale];
    const filled = !!l && !!(l.slug.trim() || l.title.trim() || l.body.trim());
    return { key: locale, label: filled ? locale : t('articles.form.missingLocale', { locale }) };
  });
  const publishedSlug = draft.status === 'PUBLISHED' && variant === 'platform' ? initial.locales[activeLocale]?.slug : null;

  return (
    <Section title={draft.id ? t('articles.form.editTitle') : t('articles.form.createTitle')} description={t('articles.form.status', { status: t(`articles.editor.status.${draft.status}`) })}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={t('articles.form.authorName')} value={draft.authorName} onChange={(v) => setDraft({ ...draft, authorName: v })} />
        <FieldGroup label={t('articles.form.coverImageUrl')} hint={t('articles.form.coverImageHint')}>
          <Input type="url" value={draft.coverImageUrl} placeholder="https://" onChange={(e) => setDraft({ ...draft, coverImageUrl: e.target.value })} />
        </FieldGroup>
      </div>

      <div className="grid gap-2">
        <span className="ui-caption ui-strong">{t('articles.form.tags')}</span>
        {tags.length === 0 ? (
          <p className="ui-caption ui-text-muted">{t('articles.form.noTags')}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => {
              const selected = draft.tagIds.includes(tag.id);
              return (
                <ChipButton
                  key={tag.id}
                  selected={selected}
                  onClick={() => setDraft({ ...draft, tagIds: selected ? draft.tagIds.filter((id) => id !== tag.id) : [...draft.tagIds, tag.id] })}
                >
                  {articleTagLabel(tag, activeLocale, siteLocales.defaultLocale)}
                </ChipButton>
              );
            })}
          </div>
        )}
      </div>

      <Tabs tabs={tabs} active={activeLocale} onChange={setActiveLocale} label={t('articles.form.localeTabs')} />

      <div className="grid gap-3 ui-rule pt-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label={t('articles.form.title')} value={current.title} onChange={(v) => setLocaleField('title', v)} />
          <FieldGroup label={t('articles.form.slug')} hint={t('articles.form.slugHint')}>
            <Input value={current.slug} onChange={(e) => setLocaleField('slug', e.target.value.toLowerCase())} />
          </FieldGroup>
        </div>
        <FieldGroup label={t('articles.form.excerpt')}>
          <Textarea rows={2} value={current.excerpt} onChange={(e) => setLocaleField('excerpt', e.target.value)} />
        </FieldGroup>
        <FieldGroup label={t('articles.form.body')} hint={t('articles.form.bodyHint')}>
          <Textarea rows={14} value={current.body} onChange={(e) => setLocaleField('body', e.target.value)} />
        </FieldGroup>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label={t('articles.form.seoTitle')} value={current.seoTitle} onChange={(v) => setLocaleField('seoTitle', v)} />
          <TextField label={t('articles.form.ogImageUrl')} value={current.ogImageUrl} onChange={(v) => setLocaleField('ogImageUrl', v)} type="url" />
        </div>
        <FieldGroup label={t('articles.form.seoDescription')}>
          <Textarea rows={2} value={current.seoDescription} onChange={(e) => setLocaleField('seoDescription', e.target.value)} />
        </FieldGroup>
        {draft.locales[activeLocale] && Object.keys(draft.locales).length > 1 && (
          <div>
            <SecondaryButton onClick={removeLocale}>{t('articles.form.removeLocale')}</SecondaryButton>
          </div>
        )}
      </div>

      {message && <InlineMessage text={message.text} tone={message.ok ? 'success' : 'error'} />}

      <div className="flex flex-wrap gap-2">
        <PrimaryButton onClick={save} disabled={busy}>
          {draft.id ? t('articles.form.save') : t('articles.form.create')}
        </PrimaryButton>
        {draft.id && draft.status !== 'PUBLISHED' && (
          <SecondaryButton onClick={() => transition('publish', 'articles.form.published')} disabled={busy}>
            {t('articles.form.publish')}
          </SecondaryButton>
        )}
        {draft.id && draft.status === 'PUBLISHED' && (
          <SecondaryButton onClick={() => transition('archive', 'articles.form.archived')} disabled={busy}>
            {t('articles.form.archive')}
          </SecondaryButton>
        )}
        {draft.id && draft.status !== 'PUBLISHED' && (
          <SecondaryButton danger onClick={remove} disabled={busy}>
            {t('articles.form.delete')}
          </SecondaryButton>
        )}
        {publishedSlug && (
          <a href={articlePath(activeLocale, publishedSlug)} target="_blank" rel="noopener noreferrer" className="pui-link ui-caption self-center">
            {t('articles.form.view')}
          </a>
        )}
        <SecondaryButton onClick={onClose} disabled={busy}>
          {t('articles.form.cancel')}
        </SecondaryButton>
      </div>
    </Section>
  );
}

function TagManager({ studioId, tags, locales, defaultLocale, onChanged }: { studioId: string; tags: ArticleTagDTO[]; locales: string[]; defaultLocale: string; onChanged: () => void }) {
  const t = useT();
  const [slug, setSlug] = useState('');
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setError(null);
    const filled = Object.fromEntries(Object.entries(labels).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
    if (!slug.trim() || Object.keys(filled).length === 0) {
      setError(t('articles.error.validation'));
      return;
    }
    try {
      await bffFetch(`sites/studio/${studioId}/article-tags`, { method: 'POST', studioId, body: { slug: slug.trim(), labels: filled } });
      setSlug('');
      setLabels({});
      onChanged();
    } catch (err) {
      setError(errorText(err, t, 'articles.tags.saveFailed'));
    }
  };

  const remove = async (tagId: string) => {
    setError(null);
    try {
      await bffFetch(`sites/studio/${studioId}/article-tags/${tagId}`, { method: 'DELETE', studioId });
      onChanged();
    } catch (err) {
      setError(errorText(err, t, 'articles.tags.saveFailed'));
    }
  };

  return (
    <Section title={t('articles.tags.title')} description={t('articles.tags.description')}>
      {tags.length > 0 && (
        <ul className="grid gap-2">
          {tags.map((tag) => (
            <li key={tag.id} className="flex flex-wrap items-center gap-2">
              <Badge tone="theme">{articleTagLabel(tag, defaultLocale)}</Badge>
              <span className="ui-caption ui-text-muted">{tag.slug}</span>
              <span className="ui-caption">{t('articles.tags.count', { count: tag.articleCount })}</span>
              <SecondaryButton danger onClick={() => remove(tag.id)}>
                {t('articles.tags.delete')}
              </SecondaryButton>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 sm:grid-cols-3 items-end">
        <FieldGroup label={t('articles.tags.slug')} hint={t('articles.form.slugHint')}>
          <Input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} />
        </FieldGroup>
        {locales.map((locale) => (
          <TextField key={locale} label={t('articles.tags.label', { locale })} value={labels[locale] ?? ''} onChange={(v) => setLabels({ ...labels, [locale]: v })} />
        ))}
      </div>
      {error && <InlineMessage text={error} tone="error" />}
      <SecondaryButton onClick={add}>{t('articles.tags.add')}</SecondaryButton>
    </Section>
  );
}
