import {
  BUNDLED_MESSAGES,
  CreateSocialConnectionSchema,
  CreateSocialPostSchema,
  SOCIAL_ERROR_CODES,
  SOCIAL_NETWORK_LIMITS,
  SOCIAL_PROVIDERS,
  SOCIAL_PROVIDER_ALLOWED_HOSTS,
  SOCIAL_RETRY_BACKOFF_MINUTES,
  SOCIAL_TRANSLATED_ERRORS,
  decideSocialApproval,
  isVideoUrl,
  parseSocialBrandCheck,
  runSocialPostChecks,
  socialEffectiveText,
  socialRetryDelayMs,
  socialTextLength,
  validateSocialPostShape,
  type MarketingCheckContext,
} from '../index';

const ctx: MarketingCheckContext = { locale: 'tr', bannedPhrases: ['garanti'], requiredDisclaimer: null };

describe('per-network limits are data', () => {
  it('has a limit row and an allow-list row for every provider', () => {
    for (const provider of SOCIAL_PROVIDERS) {
      expect(SOCIAL_NETWORK_LIMITS[provider].maxTextLength).toBeGreaterThan(0);
      expect(SOCIAL_PROVIDER_ALLOWED_HOSTS[provider].length).toBeGreaterThan(0);
    }
    expect(SOCIAL_PROVIDER_ALLOWED_HOSTS.META_PAGE).toEqual(['graph.facebook.com']);
    expect(SOCIAL_PROVIDER_ALLOWED_HOSTS.INSTAGRAM).toEqual(['graph.facebook.com', 'graph.instagram.com']);
    expect(SOCIAL_PROVIDER_ALLOWED_HOSTS.LINKEDIN_ORG).toEqual(['api.linkedin.com']);
  });

  it('counts the Instagram link as part of the caption and the other networks not', () => {
    expect(socialEffectiveText('INSTAGRAM', 'Merhaba', 'https://example.com/a')).toBe('Merhaba\nhttps://example.com/a');
    expect(socialEffectiveText('META_PAGE', 'Merhaba', 'https://example.com/a')).toBe('Merhaba');
    expect(socialTextLength('INSTAGRAM', 'abc', 'https://x.io')).toBe('abc\nhttps://x.io'.length);
    expect(socialTextLength('LINKEDIN_ORG', 'abc', 'https://x.io')).toBe(3);
  });

  it('counts Unicode code points, not UTF-16 units', () => {
    expect(socialTextLength('META_PAGE', 'ğüşiöç', null)).toBe(6);
    expect(socialTextLength('META_PAGE', '\u{1D11E}', null)).toBe(1);
  });
});

describe('brand check of a social post', () => {
  it('is clean for plain text inside the limit', () => {
    expect(runSocialPostChecks('LINKEDIN_ORG', { text: 'Yeni haftanin plani hazir.' }, ctx)).toEqual([]);
  });

  it('blocks a banned phrase, an emoji and HTML', () => {
    const codes = (text: string) => runSocialPostChecks('META_PAGE', { text }, ctx).map((i) => `${i.code}:${i.severity}`);
    expect(codes('Sonuc garanti edilir')).toEqual(['BANNED_PHRASE:BLOCKING']);
    expect(codes('Merhaba \u{1F600}')).toEqual(['EMOJI:BLOCKING']);
    expect(codes('<b>Merhaba</b>')).toEqual(['HTML:BLOCKING']);
  });

  it('blocks text over the network limit, counted the way the network counts it', () => {
    const limit = SOCIAL_NETWORK_LIMITS.INSTAGRAM.maxTextLength;
    expect(runSocialPostChecks('INSTAGRAM', { text: 'a'.repeat(limit) }, ctx)).toEqual([]);
    const over = runSocialPostChecks('INSTAGRAM', { text: 'a'.repeat(limit) , link: 'https://example.com' }, ctx);
    expect(over).toEqual([expect.objectContaining({ code: 'LENGTH_EXCEEDED', severity: 'BLOCKING', field: 'text', limit })]);
    // The same text fits on a network with a bigger limit.
    expect(runSocialPostChecks('META_PAGE', { text: 'a'.repeat(limit + 1) }, ctx)).toEqual([]);
  });
});

describe('approval gating (section 6.1)', () => {
  it('self-approves a clean post when the tenant setting is off', () => {
    expect(decideSocialApproval({ requireApprovalForSocial: false, issues: [] })).toEqual({ required: false, reasons: [] });
  });

  it('warnings alone never need approval', () => {
    const issues = runSocialPostChecks('META_PAGE', { text: 'ÇOK ÖNEMLİ DUYURU BUGÜN KAÇIRMAYIN' }, ctx);
    expect(issues.every((i) => i.severity === 'WARNING')).toBe(true);
    expect(decideSocialApproval({ requireApprovalForSocial: false, issues }).required).toBe(false);
  });

  it('requires approval for a blocking issue', () => {
    const issues = runSocialPostChecks('META_PAGE', { text: 'garanti' }, ctx);
    expect(decideSocialApproval({ requireApprovalForSocial: false, issues })).toEqual({ required: true, reasons: ['SOCIAL_BRAND_CHECK_BLOCKING'] });
  });

  it('requires approval for everything when requireApprovalForSocial is on, and names both reasons', () => {
    expect(decideSocialApproval({ requireApprovalForSocial: true, issues: [] })).toEqual({ required: true, reasons: ['SOCIAL_APPROVAL_REQUIRED_SETTING'] });
    const issues = runSocialPostChecks('META_PAGE', { text: 'garanti' }, ctx);
    expect(decideSocialApproval({ requireApprovalForSocial: true, issues }).reasons).toEqual(['SOCIAL_APPROVAL_REQUIRED_SETTING', 'SOCIAL_BRAND_CHECK_BLOCKING']);
  });
});

describe('post shape per network', () => {
  it('Instagram needs exactly one media URL', () => {
    expect(validateSocialPostShape('INSTAGRAM', { mediaUrls: [] })).toEqual(['MEDIA_REQUIRED']);
    expect(validateSocialPostShape('INSTAGRAM', { mediaUrls: ['https://a.io/1.jpg'] })).toEqual([]);
    expect(validateSocialPostShape('INSTAGRAM', { mediaUrls: ['https://a.io/1.jpg', 'https://a.io/2.jpg'] })).toEqual(['TOO_MANY_MEDIA']);
  });

  it('LinkedIn takes no media yet and a Page takes at most one', () => {
    expect(validateSocialPostShape('LINKEDIN_ORG', { mediaUrls: ['https://a.io/1.jpg'] })).toEqual(['MEDIA_NOT_SUPPORTED']);
    expect(validateSocialPostShape('META_PAGE', { mediaUrls: [] })).toEqual([]);
    expect(validateSocialPostShape('META_PAGE', { mediaUrls: ['https://a.io/1.jpg', 'https://a.io/2.jpg'] })).toEqual(['TOO_MANY_MEDIA']);
  });

  it('tells videos from images by extension', () => {
    expect(isVideoUrl('https://a.io/clip.MP4?x=1')).toBe(true);
    expect(isVideoUrl('https://a.io/photo.jpg')).toBe(false);
  });
});

describe('retry backoff schedule', () => {
  it('waits longer after every retryable failure and gives up after the last step', () => {
    expect(SOCIAL_RETRY_BACKOFF_MINUTES).toEqual([1, 5, 15, 60]);
    expect([1, 2, 3, 4].map((n) => socialRetryDelayMs(n))).toEqual([60_000, 300_000, 900_000, 3_600_000]);
    expect(socialRetryDelayMs(5)).toBeNull();
    expect(socialRetryDelayMs(0)).toBeNull();
  });
});

describe('schemas and messages', () => {
  it('accepts a post with https media only', () => {
    const base = { connectionId: '11111111-1111-4111-8111-111111111111', locale: 'tr', text: 'Merhaba' };
    expect(CreateSocialPostSchema.safeParse({ ...base, mediaUrls: ['https://a.io/1.jpg'], link: 'https://a.io/?utm_source=x' }).success).toBe(true);
    expect(CreateSocialPostSchema.safeParse({ ...base, mediaUrls: ['http://a.io/1.jpg'] }).success).toBe(false);
    expect(CreateSocialPostSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });

  it('keeps the credential write-only and strict', () => {
    const ok = CreateSocialConnectionSchema.safeParse({ provider: 'INSTAGRAM', externalId: '178414', credentials: { accessToken: 'EAAB-token-1234', apiHost: 'graph.instagram.com' } });
    expect(ok.success).toBe(true);
    expect(CreateSocialConnectionSchema.safeParse({ provider: 'INSTAGRAM', externalId: '178414', credentials: { accessToken: 'x' } }).success).toBe(false);
    expect(CreateSocialConnectionSchema.safeParse({ provider: 'INSTAGRAM', externalId: '178414', credentials: { accessToken: 'EAAB-token-1234', apiHost: 'evil.example.com' } }).success).toBe(false);
  });

  it('parses an empty stored brand check', () => {
    expect(parseSocialBrandCheck({})).toEqual({ checkedAt: '', issues: [] });
  });

  it('has a Turkish and an English message for every stable error code', () => {
    for (const code of SOCIAL_ERROR_CODES) {
      const key = SOCIAL_TRANSLATED_ERRORS[code];
      expect(BUNDLED_MESSAGES.tr?.[key]).toBeTruthy();
      expect(BUNDLED_MESSAGES.en?.[key]).toBeTruthy();
    }
  });
});
