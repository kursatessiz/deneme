import {
  AD_URL_TEMPLATES,
  buildCampaignName,
  detectAdPlatform,
  isUntaggedPaidTraffic,
  parseCampaignName,
  parseTrackingParams,
  TouchpointInputSchema,
} from './attribution';
import { complianceRegionOf, defaultTaxRegimeOf, formatMoney, MoneySchema } from './regions';
import { SegmentGroupSchema, validateSegmentRules } from './segments';
import { JourneyDefinitionSchema, validateJourneyGraph } from './journeys';
import { ConversionEventSchema, CONVERSION_EVENT_TYPES, META_EVENT_NAME } from './conversions';

describe('regions', () => {
  it('maps countries to compliance regions and tax regimes', () => {
    expect(complianceRegionOf('TR')).toBe('TR');
    expect(complianceRegionOf('de')).toBe('EU');
    expect(complianceRegionOf('GB')).toBe('UK');
    expect(complianceRegionOf('US')).toBe('US');
    expect(complianceRegionOf('JP')).toBe('DEFAULT');
    expect(complianceRegionOf(null)).toBe('DEFAULT');
    expect(defaultTaxRegimeOf('FR')).toBe('EU_VAT');
  });

  it('validates and formats money with its currency', () => {
    expect(MoneySchema.safeParse({ amount: '1250.50', currency: 'EUR' }).success).toBe(true);
    expect(MoneySchema.safeParse({ amount: '1,250', currency: 'EUR' }).success).toBe(false);
    expect(formatMoney({ amount: '1250.5', currency: 'USD' }, 'en-US')).toBe('$1,250.50');
  });
});

describe('attribution', () => {
  const metaUrl =
    'https://example.com/en/yoga?utm_source=ig&utm_medium=paid_social&utm_campaign=us_en_yoga_lead_202610' +
    '&utm_id=120&utm_term=lal1&utm_content=vid&pw_cid=120&pw_asid=121&pw_adid=122&pw_plc=feed&fbclid=abc&other=x';

  it('parses utm, ad ids and click ids and ignores the rest', () => {
    const parsed = parseTrackingParams(metaUrl);
    expect(parsed.utm.utm_campaign).toBe('us_en_yoga_lead_202610');
    expect(parsed.adIds).toEqual({ pw_cid: '120', pw_asid: '121', pw_adid: '122', pw_plc: 'feed' });
    expect(parsed.clickIds).toEqual({ fbclid: 'abc' });
    expect(detectAdPlatform(parsed)).toBe('META');
    expect(isUntaggedPaidTraffic(parsed)).toBe(false);
  });

  it('flags paid clicks without our ad ids', () => {
    const parsed = parseTrackingParams('https://example.com/?gclid=xyz');
    expect(detectAdPlatform(parsed)).toBe('GOOGLE');
    expect(isUntaggedPaidTraffic(parsed)).toBe(true);
    expect(parseTrackingParams('not a url')).toEqual({ utm: {}, adIds: {}, clickIds: {} });
  });

  it('accepts a touchpoint and rejects unknown parameters', () => {
    const parsed = parseTrackingParams(metaUrl);
    const base = {
      visitorId: '5b0c0f7e-2d1c-4c47-9d33-5f1a6f0e2b11',
      sessionId: '0d3f0f7e-2d1c-4c47-9d33-5f1a6f0e2b12',
      landingUrl: metaUrl,
      ...parsed,
      consent: { analytics: true, advertising: true },
    };
    expect(TouchpointInputSchema.safeParse(base).success).toBe(true);
    expect(TouchpointInputSchema.safeParse({ ...base, utm: { ...base.utm, utm_evil: 'x' } }).success).toBe(false);
  });

  it('builds and parses the campaign naming convention', () => {
    const name = buildCampaignName({ market: 'tr', language: 'tr', sector: 'pilates', objective: 'lead', yearMonth: '202610' });
    expect(name).toBe('tr_tr_pilates_lead_202610');
    expect(parseCampaignName(name)).toEqual({ market: 'tr', language: 'tr', sector: 'pilates', objective: 'lead', yearMonth: '202610' });
    expect(parseCampaignName('summer sale')).toBeNull();
    expect(parseCampaignName('tr_tr_pilates_unknown_202610')).toBeNull();
    expect(() => buildCampaignName({ market: 'TR!', language: 'tr', sector: 'x', objective: 'lead', yearMonth: '202610' })).toThrow();
  });

  it('carries our ad id parameters in every platform template', () => {
    for (const template of Object.values(AD_URL_TEMPLATES)) {
      for (const key of ['pw_cid=', 'pw_asid=', 'pw_adid=', 'utm_campaign=', 'utm_source=']) {
        expect(template).toContain(key);
      }
    }
  });
});

describe('conversions', () => {
  it('maps every event to a Meta event name', () => {
    for (const type of CONVERSION_EVENT_TYPES) expect(META_EVENT_NAME[type]).toBeTruthy();
  });

  it('validates an event', () => {
    const ok = ConversionEventSchema.safeParse({
      eventId: 'pay_12345678',
      type: 'purchase',
      occurredAt: '2026-09-28T10:00:00.000Z',
      contactId: '5b0c0f7e-2d1c-4c47-9d33-5f1a6f0e2b11',
      value: { amount: '49.00', currency: 'EUR' },
      source: { kind: 'payment', id: 'p1' },
    });
    expect(ok.success).toBe(true);
  });
});

describe('segments', () => {
  it('accepts a valid nested rule set', () => {
    const rules = {
      combinator: 'and' as const,
      rules: [
        { field: 'contact.lifecycleStage', op: 'in', value: ['MEMBER', 'LAPSED'] },
        { field: 'activity.lastAttendedDaysAgo', op: 'gt', value: 21 },
        {
          combinator: 'or' as const,
          rules: [
            { field: 'contact.tags', op: 'has_any', value: ['vip'] },
            { field: 'custom.goal', op: 'eq', value: 'strength' },
          ],
        },
      ],
    };
    expect(SegmentGroupSchema.safeParse(rules).success).toBe(true);
    expect(validateSegmentRules(rules, { goal: 'string' })).toEqual([]);
  });

  it('reports unknown fields, wrong operators, wrong values and depth', () => {
    const issues = validateSegmentRules({
      combinator: 'and',
      rules: [
        { field: 'contact.nope', op: 'eq', value: 'x' },
        { field: 'activity.attendedTotal', op: 'contains', value: 'x' },
        { field: 'contact.lifecycleStage', op: 'in', value: ['MEMBER', 'ALIEN'] },
        { field: 'package.hasActive', op: 'is_true', value: true },
        { field: 'payment.totalSpent', op: 'between', value: [1] },
        { field: 'custom.unknown', op: 'eq', value: 'x' },
        { combinator: 'and', rules: [{ combinator: 'and', rules: [{ combinator: 'and', rules: [{ field: 'contact.locale', op: 'eq', value: 'en' }] }] }] },
      ],
    });
    const messages = issues.map((i) => i.message).join(' | ');
    expect(messages).toContain('Bilinmeyen alan: contact.nope');
    expect(messages).toContain('geçersiz işlem');
    expect(messages).toContain('Geçersiz değer: ALIEN');
    expect(messages).toContain('değer almaz');
    expect(messages).toContain('iki değer');
    expect(messages).toContain('custom.unknown');
    expect(messages).toContain('iç içe');
  });

  it('rejects raw text that looks like SQL in field names', () => {
    expect(SegmentGroupSchema.safeParse({ combinator: 'and', rules: [{ field: 'contact.x; drop table', op: 'eq', value: 1 }] }).success).toBe(false);
  });
});

describe('journeys', () => {
  const template = '5b0c0f7e-2d1c-4c47-9d33-5f1a6f0e2b11';
  const trialNurture = {
    trigger: { kind: 'event' as const, event: 'trial_booked' as const },
    entryStepId: 'welcome',
    steps: {
      welcome: { type: 'send' as const, channel: 'WHATSAPP' as const, templateId: template, purpose: 'TRANSACTIONAL' as const, next: 'wait_day' },
      wait_day: { type: 'wait' as const, minutes: 1440, next: 'attended' },
      attended: {
        type: 'branch' as const,
        condition: { combinator: 'and' as const, rules: [{ field: 'contact.lifecycleStage', op: 'in', value: ['TRIAL'] }] },
        ifTrue: 'offer',
        ifFalse: null,
      },
      offer: { type: 'send' as const, channel: 'EMAIL' as const, templateId: template, purpose: 'COMMERCIAL' as const, next: null },
    },
  };

  it('accepts an acyclic journey', () => {
    const parsed = JourneyDefinitionSchema.parse(trialNurture);
    expect(validateJourneyGraph(parsed)).toEqual([]);
  });

  it('rejects cycles, dangling links, unreachable steps and bad waits', () => {
    const cyclic = JourneyDefinitionSchema.parse({
      ...trialNurture,
      steps: { ...trialNurture.steps, offer: { ...trialNurture.steps.offer, next: 'welcome' } },
    });
    expect(validateJourneyGraph(cyclic)).toContain('Akışta döngü var');

    const dangling = JourneyDefinitionSchema.parse({
      ...trialNurture,
      steps: { ...trialNurture.steps, offer: { ...trialNurture.steps.offer, next: 'missing' } },
    });
    expect(validateJourneyGraph(dangling)[0]).toContain('missing');

    const orphan = JourneyDefinitionSchema.parse({
      ...trialNurture,
      steps: { ...trialNurture.steps, lonely: { type: 'wait', minutes: 5, next: null } },
    });
    expect(validateJourneyGraph(orphan).join(' ')).toContain('lonely');

    const badWait = JourneyDefinitionSchema.parse({
      ...trialNurture,
      steps: { ...trialNurture.steps, wait_day: { type: 'wait', next: 'attended' } },
    });
    expect(validateJourneyGraph(badWait).join(' ')).toContain('bekleme');
  });
});
