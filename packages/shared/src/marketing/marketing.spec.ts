import {
  AbTestSetupSchema,
  ContentItemsQuerySchema,
  CreateContentItemSchema,
  GenerateDraftsSchema,
  MARKETING_DRAFT_KINDS,
  MARKETING_CONTENT_SCHEMAS,
  MARKETING_MIN_CELL,
  ProductFactInputSchema,
  UpsertBrandKitSchema,
  countOrNull,
  findBannedPhrases,
  hasBlockingIssues,
  isCalendarItemMovable,
  isFactUsable,
  monthGridDates,
  parseMarketingContent,
  redactPii,
  runMarketingChecks,
  safeAggregateLabel,
  smsSegmentInfo,
  suppressSmallCells,
  weekDates,
} from '../index';

const ctx = { locale: 'tr', bannedPhrases: ['garanti', 'en iyi'], requiredDisclaimer: null as string | null };

describe('redactPii', () => {
  it('masks e-mail addresses and long digit runs but keeps short numbers and ISO dates', () => {
    expect(redactPii('Yaz: ayse@example.com veya +90 532 111 22 33')).toBe('Yaz: [email] veya [phone]');
    expect(redactPii('14 gun, 3 kisi, 2026-10-20, 250 TL')).toBe('14 gun, 3 kisi, 2026-10-20, 250 TL');
    expect(redactPii('0532-111-2233')).toBe('[phone]');
  });
});

describe('k-anonymity helpers', () => {
  it('drops cells below k and folds them only when the sum reaches k', () => {
    const result = suppressSmallCells([
      { label: 'a', count: 9 },
      { label: 'b', count: 4 },
      { label: 'c', count: 2 },
    ]);
    expect(result.cells).toEqual([{ label: 'a', count: 9 }]);
    expect(result.otherCount).toBe(6);
    expect(suppressSmallCells([{ label: 'a', count: 9 }, { label: 'b', count: 2 }]).otherCount).toBe(0);
  });

  it('shows a count only when at least k', () => {
    expect(countOrNull(MARKETING_MIN_CELL - 1)).toBeNull();
    expect(countOrNull(MARKETING_MIN_CELL)).toBe(MARKETING_MIN_CELL);
  });

  it('keeps identifying free text out of labels', () => {
    expect(safeAggregateLabel('newsletter', 'unknown')).toBe('newsletter');
    expect(safeAggregateLabel('bob@example.com', 'unknown')).toBe('unknown');
    expect(safeAggregateLabel('12345678', 'unknown')).toBe('unknown');
    expect(safeAggregateLabel('x'.repeat(41), 'unknown')).toBe('unknown');
    expect(safeAggregateLabel(null, 'unknown')).toBe('unknown');
  });
});

describe('deterministic brand checks', () => {
  it('catches banned phrases on word boundaries, case-insensitively and in Turkish', () => {
    expect(findBannedPhrases('EN İYİ çözüm, GARANTİ veriyoruz', ['en iyi', 'garanti'], 'tr')).toEqual(['en iyi', 'garanti']);
    expect(findBannedPhrases('en iyimser bir plan', ['en iyi'], 'tr')).toEqual([]);
    const issues = runMarketingChecks('SMS', { text: 'Garanti sonuc {firstName}' }, ctx);
    expect(issues).toContainEqual({ code: 'BANNED_PHRASE', severity: 'BLOCKING', field: 'text', detail: 'garanti' });
    expect(hasBlockingIssues(issues)).toBe(true);
  });

  it('enforces ad length limits: Google RSA 30 and 90, and item counts', () => {
    const headline = 'a'.repeat(31);
    const issues = runMarketingChecks(
      'AD_GOOGLE_RSA',
      { headlines: [headline, 'ok', 'ok2'], descriptions: ['d'.repeat(91), 'fine'] },
      ctx,
    );
    expect(issues).toContainEqual({ code: 'LENGTH_EXCEEDED', severity: 'BLOCKING', field: 'headlines[0]', limit: 30, actual: 31 });
    expect(issues).toContainEqual({ code: 'LENGTH_EXCEEDED', severity: 'BLOCKING', field: 'descriptions[0]', limit: 90, actual: 91 });
    const counts = runMarketingChecks('AD_GOOGLE_RSA', { headlines: ['a', 'b'], descriptions: ['x'] }, ctx);
    expect(counts.filter((i) => i.code === 'COUNT_OUT_OF_RANGE').map((i) => i.field)).toEqual(['headlines', 'descriptions']);
    expect(runMarketingChecks('AD_GOOGLE_RSA', { headlines: ['a', 'b', 'c'], descriptions: ['x', 'y'] }, ctx)).toEqual([]);
  });

  it('checks Meta, LinkedIn, subject and CTA limits', () => {
    expect(runMarketingChecks('AD_META', { primaryText: 'p'.repeat(126), headline: 'h', description: '' }, ctx).map((i) => i.field)).toEqual(['primaryText']);
    expect(runMarketingChecks('AD_LINKEDIN', { introText: 'i', headline: 'h'.repeat(71), description: '' }, ctx).map((i) => i.field)).toEqual(['headline']);
    expect(runMarketingChecks('SUBJECT_LINES', { subject: 's'.repeat(71), preheader: '' }, ctx)[0]).toMatchObject({ limit: 70, actual: 71 });
    expect(runMarketingChecks('CTA_VARIANTS', { label: 'l'.repeat(31) }, ctx)[0]).toMatchObject({ limit: 30 });
  });

  it('requires the channel disclaimer verbatim and reports it as blocking', () => {
    const withRule = { ...ctx, requiredDisclaimer: 'Cikis icin STOP yazin.' };
    expect(runMarketingChecks('SMS', { text: 'Merhaba {firstName}' }, withRule)).toContainEqual({ code: 'MISSING_DISCLAIMER', severity: 'BLOCKING', field: 'text' });
    expect(runMarketingChecks('SMS', { text: 'Merhaba {firstName}. cikis icin  stop yazin.' }, withRule)).toEqual([]);
    // Ads have no disclaimer field.
    expect(runMarketingChecks('AD_META', { primaryText: 'p', headline: 'h', description: '' }, withRule)).toEqual([]);
  });

  it('flags emoji, markup and placeholders the engine cannot fill', () => {
    const codes = (content: unknown) => runMarketingChecks('SMS', content, ctx).map((i) => i.code);
    expect(codes({ text: 'Selam \u{1F600}' })).toContain('EMOJI');
    expect(codes({ text: '<b>x</b>' })).toContain('HTML');
    expect(runMarketingChecks('SMS', { text: 'Hi {firstName} {unknownThing}' }, ctx)).toContainEqual({
      code: 'UNKNOWN_PLACEHOLDER',
      severity: 'BLOCKING',
      field: 'text',
      detail: 'unknownThing',
    });
    expect(codes({ text: 'Hi {firstName} {studioName}' })).toEqual([]);
  });

  it('warns (without blocking) about shouting, exclamation chains, SMS segments and WhatsApp edge placeholders', () => {
    const shouting = runMarketingChecks('SMS', { text: 'HEMEN SIMDI FIRSAT TEKLIF' }, ctx);
    expect(shouting).toEqual([{ code: 'SHOUTING', severity: 'WARNING', field: 'text', actual: 4 }]);
    expect(hasBlockingIssues(shouting)).toBe(false);
    expect(runMarketingChecks('SMS', { text: 'Harika! Super! Bugun!' }, ctx)[0]).toMatchObject({ code: 'EXCLAMATION_OVERUSE', severity: 'WARNING' });
    expect(runMarketingChecks('SMS', { text: 'a'.repeat(200) }, ctx)).toContainEqual({ code: 'SMS_MULTI_SEGMENT', severity: 'WARNING', field: 'text', limit: 1, actual: 2, detail: 'GSM7' });
    expect(runMarketingChecks('WHATSAPP', { templateName: 'abc', category: 'MARKETING', body: '{firstName} merhaba' }, ctx)).toEqual([
      { code: 'PLACEHOLDER_EDGE', severity: 'WARNING', field: 'body' },
    ]);
  });

  it('checks the text of segment suggestions and research notes for banned phrases but not their rules or quotes', () => {
    const suggestion = { name: 'En iyi liste', rationale: 'ok', rules: { combinator: 'and', rules: [] }, approxCount: null };
    expect(runMarketingChecks('SEGMENT_SUGGESTION', suggestion, ctx).map((i) => i.field)).toEqual(['name']);
    const note = { question: 'garanti?', summary: 's', points: [{ claim: 'c', sourceId: 'S1', quote: 'garanti verilir' }], sources: [] };
    expect(runMarketingChecks('RESEARCH_NOTE', note, ctx)).toEqual([]);
  });
});

describe('SMS segment count', () => {
  it('uses GSM-7 (160 / 153) and UCS-2 (70 / 67) rules', () => {
    expect(smsSegmentInfo('a'.repeat(160))).toEqual({ encoding: 'GSM7', length: 160, segments: 1 });
    expect(smsSegmentInfo('a'.repeat(161)).segments).toBe(2);
    expect(smsSegmentInfo('a'.repeat(307)).segments).toBe(3);
    expect(smsSegmentInfo('{}').length).toBe(4);
    expect(smsSegmentInfo('ş'.repeat(70))).toEqual({ encoding: 'UCS2', length: 70, segments: 1 });
    expect(smsSegmentInfo('ş'.repeat(71)).segments).toBe(2);
    expect(smsSegmentInfo('').segments).toBe(0);
  });
});

describe('draft content schemas', () => {
  it('has a schema for every kind and applies defaults', () => {
    for (const kind of MARKETING_DRAFT_KINDS) expect(MARKETING_CONTENT_SCHEMAS[kind]).toBeDefined();
    expect(parseMarketingContent('EMAIL', { subject: 's', body: 'b' })).toEqual({ ok: true, content: { subject: 's', preheader: '', body: 'b' } });
    expect(parseMarketingContent('SMS', { text: '' }).ok).toBe(false);
    expect(parseMarketingContent('SMS', { text: 'x', extra: 1 }).ok).toBe(false);
    expect(parseMarketingContent('AD_GOOGLE_RSA', { headlines: Array(16).fill('h'), descriptions: ['d'] }).ok).toBe(false);
  });

  it('validates a segment suggestion against the segment rule language shape', () => {
    const ok = { name: 'n', rationale: 'r', rules: { combinator: 'and', rules: [{ field: 'contact.lifecycleStage', op: 'in', value: ['LEAD'] }] }, approxCount: 12 };
    expect(parseMarketingContent('SEGMENT_SUGGESTION', ok).ok).toBe(true);
    expect(parseMarketingContent('SEGMENT_SUGGESTION', { ...ok, rules: { combinator: 'xor', rules: [] } }).ok).toBe(false);
  });
});

describe('request schemas', () => {
  const brief = { goal: 'Yeni studyolar' };

  it('limits generation requests to 12 generations and 5 variants', () => {
    expect(GenerateDraftsSchema.safeParse({ brief, locales: ['tr'], kinds: ['SMS'] }).data?.variantCount).toBe(3);
    expect(GenerateDraftsSchema.safeParse({ brief, locales: ['tr'], kinds: ['SMS'], variantCount: 6 }).success).toBe(false);
    expect(GenerateDraftsSchema.safeParse({ brief, locales: ['tr', 'en', 'de', 'fr'], kinds: ['SMS', 'EMAIL', 'AD_META', 'CTA_VARIANTS'] }).success).toBe(false);
    expect(GenerateDraftsSchema.safeParse({ brief, locales: ['tr', 'tr'], kinds: ['SMS'] }).success).toBe(false);
    expect(GenerateDraftsSchema.safeParse({ brief, locales: ['tr'], kinds: ['SEGMENT_SUGGESTION'] }).success).toBe(false);
  });

  it('validates the A/B setup stub', () => {
    const ids = ['8f1f6b8a-0c0e-4d5e-9a3b-111111111111', '8f1f6b8a-0c0e-4d5e-9a3b-222222222222'];
    expect(AbTestSetupSchema.parse({ enabled: true, variantIds: ids })).toMatchObject({ testSharePercent: 20, metric: 'CLICK', waitHours: 24 });
    expect(AbTestSetupSchema.safeParse({ enabled: true, variantIds: ids.slice(0, 1) }).success).toBe(false);
    expect(AbTestSetupSchema.safeParse({ enabled: true, variantIds: ids, testSharePercent: 90 }).success).toBe(false);
  });
});

describe('brand kit schemas', () => {
  const kit = {
    brandName: 'Acme',
    defaultLocale: 'tr',
    locales: [{ locale: 'tr', bannedPhrases: ['garanti', 'garanti'], doList: ['a'] }],
  };

  it('parses a minimal kit, deduplicates phrases and applies defaults', () => {
    const parsed = UpsertBrandKitSchema.parse(kit);
    expect(parsed.locales[0].bannedPhrases).toEqual(['garanti']);
    expect(parsed.positioning).toBe('');
    expect(parsed.icps).toEqual([]);
  });

  it('rejects duplicate languages, a default language without a row and non-https links', () => {
    expect(UpsertBrandKitSchema.safeParse({ ...kit, locales: [kit.locales[0], kit.locales[0]] }).success).toBe(false);
    expect(UpsertBrandKitSchema.safeParse({ ...kit, defaultLocale: 'en' }).success).toBe(false);
    expect(UpsertBrandKitSchema.safeParse({ ...kit, links: { website: 'http://example.com' } }).success).toBe(false);
    expect(UpsertBrandKitSchema.safeParse({ ...kit, links: { website: 'https://example.com' } }).success).toBe(true);
  });

  it('validates product facts and their expiry', () => {
    expect(ProductFactInputSchema.safeParse({ key: 'platform.trial', statements: { tr: '14 gun deneme' } }).success).toBe(true);
    expect(ProductFactInputSchema.safeParse({ key: 'Bad Key', statements: { tr: 'x' } }).success).toBe(false);
    expect(ProductFactInputSchema.safeParse({ key: 'k1', statements: {} }).success).toBe(false);
    expect(isFactUsable({ isActive: true, validUntil: '2026-10-01' }, '2026-10-02')).toBe(false);
    expect(isFactUsable({ isActive: true, validUntil: '2026-10-02' }, '2026-10-02')).toBe(true);
    expect(isFactUsable({ isActive: false, validUntil: null }, '2026-10-02')).toBe(false);
  });
});

describe('content calendar helpers', () => {
  it('validates items and query ranges', () => {
    expect(CreateContentItemSchema.parse({ title: 'Lansman e-postasi', channel: 'EMAIL', scheduledDate: '2026-10-21' }).status).toBe('PLANNED');
    expect(CreateContentItemSchema.safeParse({ title: 't', channel: 'EMAIL', scheduledDate: '2026-02-30' }).success).toBe(false);
    expect(CreateContentItemSchema.safeParse({ title: 't', channel: 'TELEX', scheduledDate: '2026-10-21' }).success).toBe(false);
    expect(ContentItemsQuerySchema.safeParse({ from: '2026-10-01', to: '2026-10-31' }).success).toBe(true);
    expect(ContentItemsQuerySchema.safeParse({ from: '2026-10-31', to: '2026-10-01' }).success).toBe(false);
    expect(ContentItemsQuerySchema.safeParse({ from: '2026-01-01', to: '2026-12-31' }).success).toBe(false);
  });

  it('lets only planned, drafted and approved items move', () => {
    expect(['PLANNED', 'DRAFTED', 'APPROVED'].every((s) => isCalendarItemMovable(s as 'PLANNED'))).toBe(true);
    expect(isCalendarItemMovable('SENT')).toBe(false);
    expect(isCalendarItemMovable('CANCELLED')).toBe(false);
  });

  it('builds whole-week month grids starting on Monday', () => {
    const grid = monthGridDates(2026, 10);
    expect(grid[0]).toBe('2026-09-28');
    expect(grid).toHaveLength(35);
    expect(grid[grid.length - 1]).toBe('2026-11-01');
    expect(weekDates('2026-10-21')).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
  });
});
