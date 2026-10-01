import { DEFAULT_TENANT_THEME } from '../design';
import {
  CreateArticleSchema,
  UpsertPageLocaleSchema,
  UpsertArticleTagSchema,
  articlePlainText,
  articlePath,
  articleSummary,
  articleTagLabel,
  blogFeedPath,
  blogIndexPath,
  blogTagPath,
  buildArticleFeedXml,
  buildArticleSitemapEntries,
  buildRssXml,
  buildSitemapXml,
  computeReadingMinutes,
  escapeXmlText,
  parseArticleBody,
  parseArticleInline,
  rssDate,
  safeArticleHref,
  unsafeArticleLinks,
} from './index';

describe('sites/article-markup', () => {
  it('splits paragraphs on blank lines and keeps single line breaks inside one paragraph', () => {
    expect(parseArticleBody('First line\nsecond line\n\nNext paragraph')).toEqual([
      { type: 'paragraph', lines: [[{ type: 'text', value: 'First line' }], [{ type: 'text', value: 'second line' }]] },
      { type: 'paragraph', lines: [[{ type: 'text', value: 'Next paragraph' }]] },
    ]);
  });

  it('recognises headings and bullet lists', () => {
    const blocks = parseArticleBody('## Why\n- one\n- **two**\nafter');
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'list', 'paragraph']);
    expect(blocks[1]).toEqual({
      type: 'list',
      items: [[{ type: 'text', value: 'one' }], [{ type: 'strong', children: [{ type: 'text', value: 'two' }] }]],
    });
  });

  it('keeps only https links and turns any other target into plain text', () => {
    expect(parseArticleInline('see [docs](https://example.com/a?b=1#c) now')).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'link', href: 'https://example.com/a?b=1#c', children: [{ type: 'text', value: 'docs' }] },
      { type: 'text', value: ' now' },
    ]);
    for (const target of ['javascript:alert(1)', 'http://example.com', '//example.com', '/relative', 'data:text/html,x', 'https://user@example.com', 'https://localhost']) {
      const nodes = parseArticleInline(`[x](${target})`);
      expect(nodes.every((n) => n.type === 'text')).toBe(true);
      expect(nodes[0]).toMatchObject({ type: 'text', value: expect.stringMatching(/^x/) });
    }
  });

  it('never passes HTML through: tags stay literal text', () => {
    const blocks = parseArticleBody('<script>alert(1)</script> **<b>x</b>**');
    expect(blocks).toEqual([
      {
        type: 'paragraph',
        lines: [[{ type: 'text', value: '<script>alert(1)</script> ' }, { type: 'strong', children: [{ type: 'text', value: '<b>x</b>' }] }]],
      },
    ]);
  });

  it('validates hrefs strictly', () => {
    expect(safeArticleHref(' https://example.com ')).toBe('https://example.com');
    expect(safeArticleHref('https://sub.example.com:8443/path')).toBe('https://sub.example.com:8443/path');
    expect(safeArticleHref('https://example.com/"onmouseover=x')).toBeNull();
    expect(safeArticleHref('HTTPS://example.com')).toBe('HTTPS://example.com');
    expect(safeArticleHref('ftp://example.com')).toBeNull();
  });

  it('reports unsafe links, also inside bold text', () => {
    expect(unsafeArticleLinks('[a](https://example.com) [b](http://x.com) **[c](javascript:void)**')).toEqual(['http://x.com', 'javascript:void']);
  });

  it('computes plain text, summary and reading time', () => {
    const body = '## Title\n\nSome **bold** and [a link](https://example.com).\n\n- item';
    expect(articlePlainText(body)).toBe('Title\n\nSome bold and a link.\n\nitem');
    expect(computeReadingMinutes(body)).toBe(1);
    expect(computeReadingMinutes(Array.from({ length: 401 }, () => 'word').join(' '))).toBe(3);
    expect(articleSummary('one two three four five', 10)).toBe('one two…');
    expect(articleSummary('short', 10)).toBe('short');
  });
});

describe('sites/articles schemas and paths', () => {
  const locale = { locale: 'tr', slug: 'ilk-yazi', title: 'Ilk yazi', body: 'Metin' };

  it('accepts a minimal article and normalises empty optional text to null', () => {
    const parsed = CreateArticleSchema.parse({ authorName: 'Ayse', locales: [{ ...locale, excerpt: '' }] });
    expect(parsed.locales[0].excerpt).toBeNull();
    expect(parsed.tagIds).toEqual([]);
    expect(parsed.coverImageUrl).toBeNull();
  });

  it('rejects duplicate locales, bad slugs, http links and a non-https cover', () => {
    expect(() => CreateArticleSchema.parse({ authorName: 'A', locales: [locale, locale] })).toThrow();
    expect(() => CreateArticleSchema.parse({ authorName: 'A', locales: [{ ...locale, slug: 'a/b' }] })).toThrow();
    expect(() => CreateArticleSchema.parse({ authorName: 'A', locales: [{ ...locale, body: '[x](http://a.com)' }] })).toThrow();
    expect(() => CreateArticleSchema.parse({ authorName: 'A', coverImageUrl: 'http://a.com/x.png', locales: [locale] })).toThrow();
    expect(() => CreateArticleSchema.parse({ authorName: 'A', locales: [{ ...locale, body: '   ' }] })).toThrow();
  });

  it('validates tags and resolves labels with fallback', () => {
    expect(() => UpsertArticleTagSchema.parse({ slug: 'haber', labels: {} })).toThrow();
    const tag = UpsertArticleTagSchema.parse({ slug: 'Haber', labels: { tr: 'Haber', en: 'News' } });
    expect(tag.slug).toBe('haber');
    expect(articleTagLabel(tag, 'en')).toBe('News');
    expect(articleTagLabel(tag, 'de', 'tr')).toBe('Haber');
    expect(articleTagLabel({ slug: 'x', labels: {} }, 'tr')).toBe('x');
  });

  it('reserves the blog segment for article routes', () => {
    expect(() => UpsertPageLocaleSchema.parse({ slug: 'blog' })).toThrow();
    expect(() => UpsertPageLocaleSchema.parse({ slug: 'blog/x' })).toThrow();
    expect(UpsertPageLocaleSchema.parse({ slug: 'bloglar' }).slug).toBe('bloglar');
  });

  it('builds locale-prefixed blog paths', () => {
    expect(blogIndexPath('tr')).toBe('/tr/blog');
    expect(articlePath('en', 'hello')).toBe('/en/blog/hello');
    expect(blogTagPath('tr', 'haber')).toBe('/tr/blog/tag/haber');
    expect(blogFeedPath('en')).toBe('/en/blog/rss.xml');
  });
});

describe('sites/articles sitemap', () => {
  const items = [
    { articleId: 'a1', locale: 'tr', slug: 'merhaba', updatedAt: '2026-10-01T10:00:00.000Z' },
    { articleId: 'a1', locale: 'en', slug: 'hello', updatedAt: '2026-10-01T10:00:00.000Z' },
    { articleId: 'a2', locale: 'tr', slug: 'ikinci', updatedAt: '2026-10-02T10:00:00.000Z' },
  ];

  it('writes one url per article variant with reciprocal hreflang and x-default', () => {
    const entries = buildArticleSitemapEntries(items, 'tr', 'https://example.com');
    const tr = entries.find((e) => e.loc === 'https://example.com/tr/blog/merhaba');
    const en = entries.find((e) => e.loc === 'https://example.com/en/blog/hello');
    expect(tr?.alternates).toEqual({
      tr: 'https://example.com/tr/blog/merhaba',
      en: 'https://example.com/en/blog/hello',
      'x-default': 'https://example.com/tr/blog/merhaba',
    });
    expect(en?.alternates).toEqual(tr?.alternates);
    const single = entries.find((e) => e.loc === 'https://example.com/tr/blog/ikinci');
    expect(single?.alternates).toEqual({ tr: 'https://example.com/tr/blog/ikinci', 'x-default': 'https://example.com/tr/blog/ikinci' });
  });

  it('lists the blog index once per locale with its latest change', () => {
    const entries = buildArticleSitemapEntries(items, 'en', 'https://example.com');
    const trIndex = entries.find((e) => e.loc === 'https://example.com/tr/blog');
    expect(trIndex?.lastModified).toBe('2026-10-02T10:00:00.000Z');
    expect(trIndex?.alternates).toEqual({ tr: 'https://example.com/tr/blog', en: 'https://example.com/en/blog', 'x-default': 'https://example.com/en/blog' });
    expect(entries.filter((e) => e.loc.endsWith('/blog'))).toHaveLength(2);
    const xml = buildSitemapXml(entries);
    expect(xml).toContain('<loc>https://example.com/en/blog/hello</loc>');
    expect(xml).toContain('hreflang="x-default" href="https://example.com/en/blog/hello"');
  });

  it('is empty for a site without published articles', () => {
    expect(buildArticleSitemapEntries([], 'tr', 'https://example.com')).toEqual([]);
  });
});

describe('sites/rss', () => {
  it('escapes every value and drops characters XML cannot carry', () => {
    expect(escapeXmlText(`a & b < c > "d" 'e'\u0001`)).toBe('a &amp; b &lt; c &gt; &quot;d&quot; &apos;e&apos;');
  });

  it('builds an RSS 2.0 channel with items, categories and RFC 822 dates', () => {
    const xml = buildRssXml({
      title: 'Blog & <News>',
      link: 'https://example.com/tr/blog',
      selfUrl: 'https://example.com/tr/blog/rss.xml',
      description: 'Yazilar',
      language: 'tr',
      items: [
        {
          title: '</title><script>x</script>',
          link: 'https://example.com/tr/blog/a?x=1&y=2',
          description: 'Ozet & daha',
          publishedAt: '2026-10-01T09:00:00.000Z',
          author: 'Ayse <Yazar>',
          categories: ['Haber & Duyuru'],
        },
      ],
    });
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"')).toBe(true);
    expect(xml).toContain('<title>Blog &amp; &lt;News&gt;</title>');
    expect(xml).toContain('<title>&lt;/title&gt;&lt;script&gt;x&lt;/script&gt;</title>');
    expect(xml).not.toContain('<script>');
    expect(xml).toContain('<link>https://example.com/tr/blog/a?x=1&amp;y=2</link>');
    expect(xml).toContain('<guid isPermaLink="true">https://example.com/tr/blog/a?x=1&amp;y=2</guid>');
    expect(xml).toContain('<pubDate>Thu, 01 Oct 2026 09:00:00 GMT</pubDate>');
    expect(xml).toContain('<dc:creator>Ayse &lt;Yazar&gt;</dc:creator>');
    expect(xml).toContain('<category>Haber &amp; Duyuru</category>');
    expect(xml).toContain('<atom:link href="https://example.com/tr/blog/rss.xml" rel="self" type="application/rss+xml"/>');
    expect(xml).toContain('<language>tr</language>');
  });

  it('formats dates as RFC 822', () => {
    expect(rssDate('2026-01-05T00:00:00Z')).toBe('Mon, 05 Jan 2026 00:00:00 GMT');
  });
});

describe('sites/rss article feed', () => {
  it('links every item on the given origin', () => {
    const xml = buildArticleFeedXml(
      {
        site: {
          siteKind: 'TENANT',
          studioSlug: 'zen',
          siteName: 'Zen',
          publisherName: 'Zen',
          logoUrl: null,
          defaultLocale: 'tr',
          enabledLocales: ['tr'],
          theme: DEFAULT_TENANT_THEME,
        },
        locale: 'tr',
        tag: null,
        publishedLocales: ['tr'],
        items: [
          { locale: 'tr', slug: 'merhaba', title: 'Merhaba', excerpt: 'Ozet', coverImageUrl: null, authorName: 'Ayse', publishedAt: '2026-10-01T09:00:00.000Z', updatedAt: '2026-10-01T09:00:00.000Z', readingMinutes: 1, tags: [{ slug: 'haber', label: 'Haber' }] },
        ],
        total: 1,
        page: 1,
        pageSize: 12,
      },
      'https://zen.example.com',
      { title: 'Zen blogu', description: 'Zen yazilari' },
    );
    expect(xml).toContain('<link>https://zen.example.com/tr/blog</link>');
    expect(xml).toContain('<link>https://zen.example.com/tr/blog/merhaba</link>');
    expect(xml).toContain('href="https://zen.example.com/tr/blog/rss.xml"');
    expect(xml).toContain('<category>Haber</category>');
  });
});
