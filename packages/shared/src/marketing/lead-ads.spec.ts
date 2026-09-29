import {
  ConfigureLeadAdsSchema,
  DEFAULT_LEAD_AD_FIELD_MAP,
  LEAD_AD_MAX_ATTEMPTS,
  LEAD_AD_RETRY_DELAYS_SECONDS,
  MAX_LEAD_AD_ATTRIBUTES,
  UpsertLeadAdFormMappingSchema,
  isConsentAnswerGiven,
  isPermanentGraphStatus,
  mapLeadFields,
  nextLeadAdAttemptAt,
  parseLeadgenNotifications,
} from './lead-ads';
import { ALL_WEBHOOK_EVENTS, PLATFORM_WEBHOOK_EVENTS, PublicRecordConsentSchema, PublicUpsertContactSchema, TENANT_WEBHOOK_EVENTS, WEBHOOK_SAMPLE_DATA, isApiKeyScope } from '../open-platform';

const change = (value: unknown, field = 'leadgen') => ({ field, value });

describe('parseLeadgenNotifications', () => {
  it('reads every leadgen change and skips other fields and malformed values', () => {
    const body = {
      object: 'page',
      entry: [
        {
          id: '111',
          time: 1,
          changes: [
            change({ leadgen_id: '900', page_id: '111', form_id: '222', ad_id: '333', created_time: 1_700_000_000 }),
            change({ leadgen_id: '901', page_id: '111', form_id: '222' }, 'feed'),
            change({ leadgen_id: 'not-a-number', page_id: '111', form_id: '222' }),
            change({ page_id: '111' }),
          ],
        },
      ],
    };
    const out = parseLeadgenNotifications(body);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ pageId: '111', leadgenId: '900', formId: '222', adId: '333' });
    expect(out[0].createdTime?.toISOString()).toBe('2023-11-14T22:13:20.000Z');
  });

  it('returns nothing for a body that is not a notification', () => {
    expect(parseLeadgenNotifications(null)).toEqual([]);
    expect(parseLeadgenNotifications('x')).toEqual([]);
    expect(parseLeadgenNotifications({ entry: 5 })).toEqual([]);
    expect(parseLeadgenNotifications({})).toEqual([]);
  });
});

describe('mapLeadFields', () => {
  const field = (name: string, ...values: string[]) => ({ name, values });

  it('maps Meta standard questions with the default map', () => {
    const mapped = mapLeadFields(
      [field('full_name', 'Ada Lovelace'), field('email', 'ADA@Example.com'), field('phone_number', '+4915112345678'), field('company_name', 'Analytical Engines'), field('country', 'de')],
      null,
      null,
    );
    expect(mapped).toMatchObject({
      fullName: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: '+4915112345678',
      company: 'Analytical Engines',
      countryCode: 'DE',
      consentGiven: null,
    });
    expect(mapped.attributes).toEqual({});
  });

  it('keeps unknown questions in the attributes bag', () => {
    const mapped = mapLeadFields([field('email', 'a@b.co'), field('team_size', '10-20'), field('interests', 'yoga', 'pilates')], null, null);
    expect(mapped.attributes).toEqual({ team_size: '10-20', interests: 'yoga, pilates' });
  });

  it('lets a stored mapping route a custom question and override a default', () => {
    const mapped = mapLeadFields(
      [field('your_name', 'Grace Hopper'), field('contact_mail', 'g@h.io'), field('phone_number', '123')],
      { your_name: 'full_name', contact_mail: 'email', phone_number: 'company' },
      null,
    );
    expect(mapped.fullName).toBe('Grace Hopper');
    expect(mapped.email).toBe('g@h.io');
    expect(mapped.company).toBe('123');
    expect(mapped.phone).toBeNull();
  });

  it('takes the first non-empty value and ignores empty answers', () => {
    const mapped = mapLeadFields([field('email', '  ', 'first@x.io', 'second@x.io'), field('phone_number', '')], null, null);
    expect(mapped.email).toBe('first@x.io');
    expect(mapped.phone).toBeNull();
  });

  it('keeps an unusable country in the attributes bag instead of dropping it', () => {
    const mapped = mapLeadFields([field('country', 'Germany')], null, null);
    expect(mapped.countryCode).toBeNull();
    expect(mapped.attributes).toEqual({ country: 'Germany' });
  });

  it('reads the consent question as the consent answer and never stores it as an attribute', () => {
    const ticked = mapLeadFields([field('email', 'a@b.co'), field('marketing_ok', 'Yes')], null, 'marketing_ok');
    expect(ticked.consentGiven).toBe(true);
    expect(ticked.attributes).toEqual({});
    const unticked = mapLeadFields([field('email', 'a@b.co'), field('marketing_ok')], null, 'marketing_ok');
    expect(unticked.consentGiven).toBe(false);
    const refused = mapLeadFields([field('marketing_ok', 'no')], null, 'marketing_ok');
    expect(refused.consentGiven).toBe(false);
  });

  it('has no consent decision when the form has no consent question', () => {
    expect(mapLeadFields([field('marketing_ok', 'yes')], null, null).consentGiven).toBeNull();
    // Without a consent question the answer is just another unknown question.
    expect(mapLeadFields([field('marketing_ok', 'yes')], null, null).attributes).toEqual({ marketing_ok: 'yes' });
  });

  it('caps and truncates the attributes bag', () => {
    const many = Array.from({ length: MAX_LEAD_AD_ATTRIBUTES + 20 }, (_, i) => field(`q${i}`, 'x'.repeat(900)));
    const mapped = mapLeadFields(many, null, null);
    expect(Object.keys(mapped.attributes)).toHaveLength(MAX_LEAD_AD_ATTRIBUTES);
    expect(Object.values(mapped.attributes)[0]).toHaveLength(500);
  });

  it('default map covers the standard keys', () => {
    expect(DEFAULT_LEAD_AD_FIELD_MAP.phone_number).toBe('phone');
    expect(DEFAULT_LEAD_AD_FIELD_MAP.company_name).toBe('company');
  });
});

describe('isConsentAnswerGiven', () => {
  it('treats a ticked box as given and an empty or negative answer as not given', () => {
    expect(isConsentAnswerGiven(['Yes'])).toBe(true);
    expect(isConsentAnswerGiven(['I agree to receive offers'])).toBe(true);
    expect(isConsentAnswerGiven([])).toBe(false);
    expect(isConsentAnswerGiven(undefined)).toBe(false);
    expect(isConsentAnswerGiven([' '])).toBe(false);
    expect(isConsentAnswerGiven(['FALSE'])).toBe(false);
    expect(isConsentAnswerGiven(['No'])).toBe(false);
  });
});

describe('retry policy', () => {
  const now = new Date('2026-10-27T10:00:00.000Z');

  it('backs off after each failed attempt and stops when the attempts are used up', () => {
    expect(nextLeadAdAttemptAt(1, now)?.getTime()).toBe(now.getTime() + LEAD_AD_RETRY_DELAYS_SECONDS[0] * 1000);
    expect(nextLeadAdAttemptAt(2, now)?.getTime()).toBe(now.getTime() + LEAD_AD_RETRY_DELAYS_SECONDS[1] * 1000);
    expect(nextLeadAdAttemptAt(LEAD_AD_MAX_ATTEMPTS - 1, now)).not.toBeNull();
    expect(nextLeadAdAttemptAt(LEAD_AD_MAX_ATTEMPTS, now)).toBeNull();
  });

  it('calls auth and lookup failures permanent and server trouble transient', () => {
    for (const status of [400, 401, 403, 404]) expect(isPermanentGraphStatus(status)).toBe(true);
    for (const status of [429, 500, 502, 503]) expect(isPermanentGraphStatus(status)).toBe(false);
  });
});

describe('hub and settings schemas', () => {
  it('accepts a form mapping and refuses unknown targets and stray keys', () => {
    expect(UpsertLeadAdFormMappingSchema.safeParse({ mapping: { q1: 'email' }, consentQuestionKey: 'ok' }).success).toBe(true);
    expect(UpsertLeadAdFormMappingSchema.safeParse({ mapping: { q1: 'salary' } }).success).toBe(false);
    expect(UpsertLeadAdFormMappingSchema.safeParse({ mapping: {}, extra: 1 }).success).toBe(false);
    expect(UpsertLeadAdFormMappingSchema.parse({ mapping: {} }).consentQuestionKey).toBeNull();
  });

  it('needs a page id or an app secret and never a short secret', () => {
    expect(ConfigureLeadAdsSchema.safeParse({}).success).toBe(false);
    expect(ConfigureLeadAdsSchema.safeParse({ pageId: '12345' }).success).toBe(true);
    expect(ConfigureLeadAdsSchema.safeParse({ appSecret: 'short' }).success).toBe(false);
    expect(ConfigureLeadAdsSchema.safeParse({ appSecret: 'a'.repeat(32) }).success).toBe(true);
  });
});

describe('platform events and public schemas', () => {
  it('catalogues the platform events with samples and keeps them out of the tenant list', () => {
    for (const event of PLATFORM_WEBHOOK_EVENTS) {
      expect(ALL_WEBHOOK_EVENTS).toContain(event);
      expect(WEBHOOK_SAMPLE_DATA[event]).toBeDefined();
      expect(TENANT_WEBHOOK_EVENTS).not.toContain(event);
    }
    expect(PLATFORM_WEBHOOK_EVENTS).toEqual(['studio.signup', 'studio.paid', 'studio.trial_expiring', 'contact.lifecycle_changed', 'campaign.sent']);
  });

  it('has the crm.write scope', () => {
    expect(isApiKeyScope('crm.write')).toBe(true);
  });

  it('needs an email or a phone to upsert a contact and normalises tags', () => {
    expect(PublicUpsertContactSchema.safeParse({ firstName: 'Ada' }).success).toBe(false);
    const ok = PublicUpsertContactSchema.parse({ email: 'a@b.co', tags: ['  VIP  ', 'Lead'] });
    expect(ok.tags).toEqual(['vip', 'lead']);
    expect(PublicUpsertContactSchema.safeParse({ email: 'a@b.co', tags: ['!!'] }).success).toBe(false);
    expect(PublicUpsertContactSchema.safeParse({ email: 'a@b.co', studioId: 'x' }).success).toBe(false);
  });

  it('needs the form version for a consent grant but not for a revocation', () => {
    expect(PublicRecordConsentSchema.safeParse({ channels: ['EMAIL'] }).success).toBe(false);
    const ok = PublicRecordConsentSchema.parse({ channels: ['EMAIL', 'EMAIL', 'SMS'], formVersion: 'lf-en-1a2b3c4d' });
    expect(ok.channels).toEqual(['EMAIL', 'SMS']);
    expect(ok.legalBasis).toBe('CONSENT');
    expect(PublicRecordConsentSchema.safeParse({ channels: ['EMAIL'], granted: false }).success).toBe(true);
    expect(PublicRecordConsentSchema.safeParse({ channels: ['EMAIL'], legalBasis: 'TR_MERCHANT_EXEMPTION' }).success).toBe(true);
    expect(PublicRecordConsentSchema.safeParse({ channels: [], formVersion: 'v1' }).success).toBe(false);
  });
});
