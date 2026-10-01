import {
  validateBlockData,
  resolveBlockText,
  assignVariant,
  fallbackStickyId,
  resolvePageLocale,
  buildHreflangAlternates,
  buildSitemapXml,
  buildRobotsTxt,
  isNonIndexablePath,
  isProtectedPath,
  NON_INDEXABLE_PATH_PREFIXES,
  PROTECTED_PATHS,
  isValidDomain,
  expectedDnsRecords,
  HeroBlockSchema,
  SAFE_HREF_PATTERN,
} from './index';

describe('sites/blocks', () => {
  it('validates a hero block and rejects unknown fields', () => {
    const data = HeroBlockSchema.parse({
      config: {},
      text: { tr: { title: 'Başlık' }, en: { title: 'Title' } },
    });
    expect(data.text.tr.title).toBe('Başlık');
    expect(validateBlockData('hero', data)).toEqual(data);
    expect(() => HeroBlockSchema.parse({ config: {}, text: { tr: { title: 'x', bogus: 1 } } })).toThrow();
  });

  it('rejects an unknown block type at the call site', () => {
    expect(() => validateBlockData('nope' as never, {})).toThrow();
  });

  it('resolves block text with locale fallback', () => {
    const text = { tr: { title: 'Merhaba' } };
    expect(resolveBlockText(text, 'en', 'tr')).toEqual({ title: 'Merhaba' });
    expect(resolveBlockText(text, 'tr', 'tr')).toEqual({ title: 'Merhaba' });
    expect(resolveBlockText(undefined, 'tr', 'tr')).toBeNull();
    expect(resolveBlockText({}, 'tr', 'tr')).toBeNull();
  });
});

describe('sites/site locale rules', () => {
  it('serves only locales the page actually has', () => {
    expect(resolvePageLocale('tr', ['tr', 'en'], 'tr')).toBe('tr');
    expect(resolvePageLocale('de', ['tr', 'en'], 'tr')).toBeNull();
  });

  it('builds hreflang alternates only for published locales', () => {
    const alt = buildHreflangAlternates(
      [
        { locale: 'tr', slug: 'pilates', seoTitle: null, seoDescription: null, ogImageUrl: null, legalApproved: true, legalApprovedAt: null },
        { locale: 'en', slug: 'pilates-software', seoTitle: null, seoDescription: null, ogImageUrl: null, legalApproved: true, legalApprovedAt: null },
      ],
      (locale, slug) => `https://example.com/${locale}/${slug}`,
    );
    expect(alt).toEqual({ tr: 'https://example.com/tr/pilates', en: 'https://example.com/en/pilates-software' });
  });
});

describe('sites/ab', () => {
  it('is deterministic for the same sticky id', () => {
    const keys = ['control', 'b'];
    const a1 = assignVariant(keys, 'visitor-1');
    const a2 = assignVariant(keys, 'visitor-1');
    expect(a1).toBe(a2);
  });

  it('spreads different ids across variants', () => {
    const keys = ['control', 'b'];
    const seen = new Set(Array.from({ length: 50 }, (_, i) => assignVariant(keys, `v-${i}`)));
    expect(seen.size).toBe(2);
  });

  it('returns the single key when there is no real split', () => {
    expect(assignVariant(['control'], 'x')).toBe('control');
    expect(assignVariant([], 'x')).toBe('control');
  });

  it('builds a stable fallback id from request signals', () => {
    const a = fallbackStickyId('UA', 'tr-TR', '2026-09-28');
    const b = fallbackStickyId('UA', 'tr-TR', '2026-09-28');
    expect(a).toBe(b);
  });
});

describe('sites/sitemap', () => {
  it('escapes and includes hreflang alternates', () => {
    const xml = buildSitemapXml([{ loc: 'https://x.com/tr?a=1&b=2', alternates: { en: 'https://x.com/en' } }]);
    expect(xml).toContain('&amp;');
    expect(xml).toContain('hreflang="en"');
  });

  it('builds robots.txt with a sitemap reference', () => {
    expect(buildRobotsTxt('https://x.com/sitemap.xml')).toContain('Sitemap: https://x.com/sitemap.xml');
  });
});

describe('sites/indexing', () => {
  it('disallows every non-indexable prefix in robots.txt and keeps public content allowed', () => {
    const txt = buildRobotsTxt('https://x.com/sitemap.xml');
    expect(txt).toContain('Allow: /\n');
    for (const p of NON_INDEXABLE_PATH_PREFIXES) {
      expect(txt).toContain(`Disallow: ${p}/\n`);
      expect(txt).toContain(`Disallow: ${p}$\n`);
    }
    expect(txt).toContain('Disallow: /giris/');
    expect(txt).toContain('Disallow: /m/u/');
    expect(txt.trimEnd().endsWith('Sitemap: https://x.com/sitemap.xml')).toBe(true);
  });

  it('matches whole path segments only', () => {
    expect(isNonIndexablePath('/members')).toBe(true);
    expect(isNonIndexablePath('/members/42')).toBe(true);
    expect(isNonIndexablePath('/membership-plans')).toBe(false);
    expect(isNonIndexablePath('/j/abc')).toBe(true);
    expect(isNonIndexablePath('/m/u/abc')).toBe(true);
    expect(isNonIndexablePath('/api/bff/x')).toBe(true);
    expect(isNonIndexablePath('/tr/pilates')).toBe(false);
    expect(isNonIndexablePath('/booking/studio/book')).toBe(false);
    expect(isNonIndexablePath('/')).toBe(false);
  });

  it('keeps the protected list a subset of the non-indexable list', () => {
    for (const p of PROTECTED_PATHS) expect(isNonIndexablePath(p)).toBe(true);
    expect(isProtectedPath('/giris')).toBe(false);
    expect(isProtectedPath('/admin/plans')).toBe(true);
  });
});

describe('sites/domain', () => {
  it('validates domain shape', () => {
    expect(isValidDomain('studio.example.com')).toBe(true);
    expect(isValidDomain('not a domain')).toBe(false);
    expect(isValidDomain('-bad.com')).toBe(false);
  });

  it('shapes the expected DNS records', () => {
    const rec = expectedDnsRecords('studio.example.com', 'tok123', 'edge.platform.example');
    expect(rec.txtHost).toBe('_platform-verify.studio.example.com');
    expect(rec.cnameValue).toBe('edge.platform.example');
  });
});

describe('sites/block links', () => {
  it.each(['/tr/iletisim', '#contact', 'https://example.com/a?b=1', 'mailto:info@example.com', 'tel:+90 212 000 00 00'])('accepts %s', (href) => {
    expect(SAFE_HREF_PATTERN.test(href)).toBe(true);
  });
  it.each(['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', '//evil.example', 'vbscript:x', ' /x y'])('rejects %s', (href) => {
    expect(SAFE_HREF_PATTERN.test(href)).toBe(false);
  });
});
