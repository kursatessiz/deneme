import { buildGoogleAdsUrl, buildGoogleAdsPayload } from './google-ads.adapter';
import { buildMetaCapiPayload, buildMetaCapiUrl } from './meta-capi.adapter';
import { buildTikTokEventsPayload, buildTikTokEventsUrl } from './tiktok-events.adapter';
import type { DeliveryContext } from './delivery-context';
import { hashEmail, hashPhoneForGoogle, hashPhoneForMeta } from './hashing';

function baseContext(overrides: Partial<DeliveryContext> = {}): DeliveryContext {
  return {
    eventId: 'purchase.abc123',
    type: 'purchase',
    occurredAt: new Date('2026-09-28T10:00:00Z'),
    value: { amount: '450.00', currency: 'TRY' },
    contact: {
      id: '11111111-1111-1111-1111-111111111111',
      firstName: 'Ayşe',
      lastName: 'Yılmaz',
      phone: '+905321112233',
      email: 'ayse@example.com',
      countryCode: 'TR',
    },
    touchpoint: {
      occurredAt: new Date('2026-09-20T10:00:00Z'),
      advertisingConsent: true,
      landingHost: 'demo.example.com',
      landingPath: '/tr/pilates',
      fbp: 'fb.1.111.222',
      fbc: 'fb.1.111.fbclid123',
      gclid: 'gclid123',
      gbraid: null,
      wbraid: null,
      ttclid: 'ttclid123',
    },
    connection: {
      platform: 'META',
      externalAccountId: 'act_1',
      pixelOrDatasetId: '999',
      conversionActionIds: { purchase: '12345' },
      isTestMode: false,
    },
    studioTimezone: 'Europe/Istanbul',
    ...overrides,
  };
}

describe('Meta CAPI adapter', () => {
  it('builds a payload with event_id de-dup, hashed identifiers and custom_data for value-bearing events', () => {
    const result = buildMetaCapiPayload(baseContext(), undefined);
    expect(result.skip).toBeNull();
    expect(result.request!.url).toBe(buildMetaCapiUrl('999'));
    const event = result.request!.body.data[0];
    expect(event.event_id).toBe('purchase.abc123');
    expect(event.event_name).toBe('Purchase');
    expect(event.user_data.em).toEqual([hashEmail('ayse@example.com')]);
    expect(event.user_data.ph).toEqual([hashPhoneForMeta('+905321112233')]);
    expect(event.user_data.fbc).toBe('fb.1.111.fbclid123');
    expect(event.custom_data).toEqual({ value: '450.00', currency: 'TRY' });
  });

  it('adds test_event_code only in test mode', () => {
    const ctx = baseContext({ connection: { ...baseContext().connection, isTestMode: true } });
    const result = buildMetaCapiPayload(ctx, 'TEST123');
    expect(result.request!.body.test_event_code).toBe('TEST123');
    const notTest = buildMetaCapiPayload(baseContext(), 'TEST123');
    expect(notTest.request!.body.test_event_code).toBeUndefined();
  });

  it('skips with SKIPPED_NO_CONSENT when no advertising consent was recorded', () => {
    expect(buildMetaCapiPayload(baseContext({ touchpoint: null }), undefined).skip).toBe('SKIPPED_NO_CONSENT');
    expect(
      buildMetaCapiPayload(baseContext({ touchpoint: { ...baseContext().touchpoint!, advertisingConsent: false } }), undefined).skip,
    ).toBe('SKIPPED_NO_CONSENT');
  });

  it('skips with SKIPPED_NO_MATCH when consent is given but there are no identifiers at all', () => {
    const ctx = baseContext({
      contact: { ...baseContext().contact, email: null, phone: null },
      touchpoint: { ...baseContext().touchpoint!, fbp: null, fbc: null },
    });
    expect(buildMetaCapiPayload(ctx, undefined).skip).toBe('SKIPPED_NO_MATCH');
  });

  it('omits custom_data for non-value-bearing events (e.g. lead)', () => {
    const result = buildMetaCapiPayload(baseContext({ type: 'lead', value: null }), undefined);
    expect(result.request!.body.data[0].custom_data).toBeUndefined();
  });
});

describe('Google Ads adapter', () => {
  it('builds an offline click conversion when gclid is present', () => {
    const result = buildGoogleAdsPayload(baseContext(), '1234567890');
    expect(result.skip).toBeNull();
    expect(result.request!.url).toBe(buildGoogleAdsUrl('act_1'));
    const conv = result.request!.body.conversions[0] as { gclid?: string; conversionAction: string; conversionValue?: number };
    expect(conv.gclid).toBe('gclid123');
    expect(conv.conversionAction).toBe('customers/act_1/conversionActions/12345');
    expect(conv.conversionValue).toBe(450);
  });

  it('falls back to enhanced conversions for leads (hashed identifiers) when there is no click id', () => {
    const ctx = baseContext({ touchpoint: { ...baseContext().touchpoint!, gclid: null, gbraid: null, wbraid: null } });
    const result = buildGoogleAdsPayload(ctx, '1234567890');
    expect(result.skip).toBeNull();
    const conv = result.request!.body.conversions[0] as { userIdentifiers: Array<{ hashedEmail?: string; hashedPhoneNumber?: string }> };
    expect(conv.userIdentifiers).toEqual([{ hashedEmail: hashEmail('ayse@example.com') }, { hashedPhoneNumber: hashPhoneForGoogle('+905321112233') }]);
  });

  it('skips with SKIPPED_NO_MATCH when the connection has no conversion action id for this event type', () => {
    const ctx = baseContext({ connection: { ...baseContext().connection, conversionActionIds: {} } });
    expect(buildGoogleAdsPayload(ctx, '1234567890').skip).toBe('SKIPPED_NO_MATCH');
  });

  it('respects the consent gate', () => {
    expect(buildGoogleAdsPayload(baseContext({ touchpoint: null }), '1234567890').skip).toBe('SKIPPED_NO_CONSENT');
  });
});

describe('TikTok Events adapter', () => {
  it('builds a payload with the ttclid callback and hashed identifiers', () => {
    const result = buildTikTokEventsPayload(baseContext());
    expect(result.skip).toBeNull();
    expect(result.request!.url).toBe(buildTikTokEventsUrl());
    const event = result.request!.body.data[0];
    expect(event.ad).toEqual({ callback: 'ttclid123' });
    expect(event.user.email).toBe(hashEmail('ayse@example.com'));
    expect(event.properties).toEqual({ value: '450.00', currency: 'TRY' });
  });

  it('skips with SKIPPED_NO_CONSENT and SKIPPED_NO_MATCH like the other adapters', () => {
    expect(buildTikTokEventsPayload(baseContext({ touchpoint: null })).skip).toBe('SKIPPED_NO_CONSENT');
    const ctx = baseContext({
      contact: { ...baseContext().contact, email: null, phone: null },
      touchpoint: { ...baseContext().touchpoint!, ttclid: null },
    });
    expect(buildTikTokEventsPayload(ctx).skip).toBe('SKIPPED_NO_MATCH');
  });
});
