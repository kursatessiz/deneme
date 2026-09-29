import { UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@platform/database';
import { LEAD_AD_MAX_ATTEMPTS } from '@platform/shared';
import type { MetaLead } from '@platform/shared';
import type { PrismaService } from '../prisma/prisma.service';
import type { CredentialCipher } from '../../common/crypto/credential-cipher';
import type { ContactsService } from '../crm/contacts/contacts.service';
import type { AttributionService } from '../crm/attribution/attribution.service';
import type { ConversionService } from '../crm/conversions/conversion.service';
import type { WebhooksService } from '../webhooks/webhooks.service';
import type { ConsentConfirmationService } from '../notifications/consent/consent-confirmation.service';
import { signMetaBody } from '../messaging/webhooks/whatsapp-signature';
import { FakeMetaGraphClient } from './fake-meta-graph.client';
import { LeadAdsService, deterministicUuid } from './lead-ads.service';

const SECRET = 'app-secret-app-secret-1234';
const PAGE = '1001';
const FORM = '2002';
const STUDIO = 'studio-1';
const NOW = new Date('2026-10-27T10:00:00.000Z');

const body = (leadgenId: string, pageId = PAGE) =>
  Buffer.from(JSON.stringify({ object: 'page', entry: [{ id: pageId, time: 1, changes: [{ field: 'leadgen', value: { leadgen_id: leadgenId, page_id: pageId, form_id: FORM, ad_id: '333' } }] }] }));

function lead(id: string, fields: { name: string; values: string[] }[], extra: Partial<MetaLead> = {}): MetaLead {
  return { id, created_time: '2026-10-27T09:59:00+0000', ad_id: '333', adset_id: '444', campaign_id: '555', form_id: FORM, field_data: fields, ...extra };
}

interface EventRow {
  id: string;
  studioId: string;
  connectionId: string;
  leadgenId: string;
  formId: string;
  pageId: string;
  adIds: unknown;
  createdTime: Date | null;
  status: string;
  attempts: number;
  contactId: string | null;
}

function setup(opts: { mapping?: { mapping: Record<string, string>; consentQuestionKey: string | null } | null; contactCountry?: string | null; existingEventOnCreate?: boolean } = {}) {
  const graph = new FakeMetaGraphClient();
  const event: EventRow = { id: 'ev-1', studioId: STUDIO, connectionId: 'conn-1', leadgenId: '9001', formId: FORM, pageId: PAGE, adIds: { adId: '333' }, createdTime: null, status: 'PENDING', attempts: 0, contactId: null };
  const created: string[] = [];
  const contact = { id: 'contact-1', studioId: STUDIO, firstName: 'Ada', lastName: 'Lovelace', phone: null, email: 'ada@example.com', countryCode: opts.contactCountry ?? null, locale: 'en', tags: [] as string[] };

  const prisma = {
    adConnection: {
      findFirst: jest.fn(async ({ where }: { where: { leadAdsPageId?: string; id?: string } }) => {
        if (where.leadAdsPageId !== undefined) return where.leadAdsPageId === PAGE ? { id: 'conn-1', studioId: STUDIO, encryptedCredentials: 'enc' } : null;
        return { id: 'conn-1', studioId: STUDIO, status: 'CONNECTED', encryptedCredentials: 'enc' };
      }),
    },
    leadAdEvent: {
      create: jest.fn(async ({ data }: { data: { leadgenId: string } }) => {
        if (opts.existingEventOnCreate) throw new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' });
        created.push(data.leadgenId);
        return { id: `ev-${data.leadgenId}` };
      }),
      updateMany: jest.fn(async () => ({ count: 1 })),
      findUniqueOrThrow: jest.fn(async () => ({ ...event })),
      update: jest.fn(async (args: { data: Record<string, unknown> }) => ({ ...event, ...args.data })),
    },
    leadAdFormMapping: { findUnique: jest.fn(async () => (opts.mapping ? { mapping: opts.mapping.mapping, consentQuestionKey: opts.mapping.consentQuestionKey } : null)) },
    studio: { findUniqueOrThrow: jest.fn(async () => ({ countryCode: 'DE' })) },
    contact: { findFirst: jest.fn(async () => ({ ...contact, pipelineStage: { kind: 'OPEN' } })) },
    visitor: { upsert: jest.fn(async () => ({})) },
    touchpoint: { findFirst: jest.fn(async () => null), create: jest.fn(async () => ({})) },
    contactActivity: { findFirst: jest.fn(async () => null), create: jest.fn(async () => ({})) },
    auditLog: { create: jest.fn(async () => ({})) },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const cipher = { decrypt: jest.fn(() => JSON.stringify({ accessToken: 'tok-1234', pixelId: '123456789', appSecret: SECRET })) };
  const contacts = { resolveOrCreate: jest.fn(async () => ({ contact, created: true })), moveToStage: jest.fn(async () => undefined) };
  const attribution = { refreshContactTouches: jest.fn(async () => undefined) };
  const conversions = { recordSafely: jest.fn(async () => ({ created: true })) };
  const webhooks = { emit: jest.fn(async () => undefined) };
  const consents = { afterFormConsent: jest.fn(async () => ({ pending: false, sent: false })) };
  const service = new LeadAdsService(
    prisma as unknown as PrismaService,
    cipher as unknown as CredentialCipher,
    graph,
    contacts as unknown as ContactsService,
    attribution as unknown as AttributionService,
    conversions as unknown as ConversionService,
    webhooks as unknown as WebhooksService,
    consents as unknown as ConsentConfirmationService,
  );
  return { service, prisma, graph, contacts, conversions, consents, webhooks, created, event };
}

describe('LeadAdsService.receive (signature and idempotency)', () => {
  it('rejects a missing or malformed signature header', async () => {
    const { service, prisma } = setup();
    await expect(service.receive(body('9001'), undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.receive(body('9001'), 'sha1=abc')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.receive(body('9001'), 'sha256=nothex')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.leadAdEvent.create).not.toHaveBeenCalled();
  });

  it('rejects a signature made with another secret and a body that is not JSON', async () => {
    const { service, prisma } = setup();
    const raw = body('9001');
    await expect(service.receive(raw, signMetaBody(raw, 'some-other-secret-value-1'))).rejects.toBeInstanceOf(UnauthorizedException);
    const junk = Buffer.from('not json');
    await expect(service.receive(junk, signMetaBody(junk, SECRET))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.leadAdEvent.create).not.toHaveBeenCalled();
  });

  it('rejects a correctly signed notification for a page with no connection', async () => {
    const { service } = setup();
    const raw = body('9001', '9999');
    await expect(service.receive(raw, signMetaBody(raw, SECRET))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('records a verified notification once and processes it', async () => {
    const { service, graph, created } = setup();
    graph.addLead(lead('9001', [{ name: 'email', values: ['ada@example.com'] }]));
    const raw = body('9001');
    const res = await service.receive(raw, signMetaBody(raw, SECRET), NOW);
    expect(res).toEqual({ received: 1, duplicates: 0, processed: 1 });
    expect(created).toEqual(['9001']);
  });

  it('ignores a re-delivered notification without processing it again', async () => {
    const { service, graph } = setup({ existingEventOnCreate: true });
    const raw = body('9001');
    const res = await service.receive(raw, signMetaBody(raw, SECRET), NOW);
    expect(res).toEqual({ received: 0, duplicates: 1, processed: 0 });
    expect(graph.fetchCalls).toHaveLength(0);
  });

  it('accepts a verified body with no leadgen change and does nothing', async () => {
    const { service, prisma } = setup();
    const raw = Buffer.from(JSON.stringify({ object: 'page', entry: [{ id: PAGE, changes: [{ field: 'feed', value: {} }] }] }));
    await expect(service.receive(raw, signMetaBody(raw, SECRET))).resolves.toEqual({ received: 0, duplicates: 0, processed: 0 });
    expect(prisma.leadAdEvent.create).not.toHaveBeenCalled();
  });
});

describe('LeadAdsService.processEvent (mapping, attribution and consent)', () => {
  it('creates the contact, a lead conversion and a touchpoint carrying campaign, ad set and ad ids', async () => {
    const { service, graph, contacts, conversions, prisma, webhooks } = setup();
    graph.addLead(
      lead('9001', [
        { name: 'full_name', values: ['Ada Lovelace'] },
        { name: 'email', values: ['ADA@example.com'] },
        { name: 'phone_number', values: ['+4915112345678'] },
        { name: 'company_name', values: ['Analytical Engines'] },
        { name: 'team_size', values: ['10'] },
      ]),
    );
    const outcome = await service.processEvent('ev-1', NOW);
    expect(outcome).toBe('PROCESSED');

    expect(contacts.resolveOrCreate).toHaveBeenCalledWith(
      STUDIO,
      expect.objectContaining({ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', phone: '+4915112345678', sourceChannel: 'META_LEAD_AD', sourceDetail: FORM, pipelineStageKey: 'NEW' }),
    );
    expect(conversions.recordSafely).toHaveBeenCalledWith(expect.objectContaining({ studioId: STUDIO, type: 'lead', contactId: 'contact-1', source: { kind: 'meta_lead_ad', id: '9001' } }));
    expect(prisma.touchpoint.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ studioId: STUDIO, adPlatform: 'META', pwCid: '555', pwAsid: '444', pwAdid: '333', utmSource: 'meta', utmMedium: 'lead_ads', contactId: 'contact-1' }),
    });
    expect(webhooks.emit).toHaveBeenCalledWith(STUDIO, 'lead.created', expect.objectContaining({ contactId: 'contact-1', source: 'META_LEAD_AD' }));
    // Unknown questions and the company stay in the attributes bag on the event.
    const finalUpdate = prisma.$transaction.mock.calls[0][0][0];
    await finalUpdate;
    expect(prisma.leadAdEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PROCESSED', contactId: 'contact-1', attributes: { team_size: '10', company: 'Analytical Engines' } }) }),
    );
  });

  it('records no consent when the form has no consent question', async () => {
    const { service, graph, consents } = setup({ mapping: { mapping: {}, consentQuestionKey: null } });
    graph.addLead(lead('9001', [{ name: 'email', values: ['ada@example.com'] }, { name: 'marketing_ok', values: ['yes'] }]));
    expect(await service.processEvent('ev-1', NOW)).toBe('PROCESSED');
    expect(consents.afterFormConsent).not.toHaveBeenCalled();
  });

  it('records no consent when the consent box was not ticked', async () => {
    const { service, graph, consents } = setup({ mapping: { mapping: {}, consentQuestionKey: 'marketing_ok' } });
    graph.addLead(lead('9001', [{ name: 'email', values: ['ada@example.com'] }, { name: 'marketing_ok', values: [] }]));
    expect(await service.processEvent('ev-1', NOW)).toBe('PROCESSED');
    expect(consents.afterFormConsent).not.toHaveBeenCalled();
  });

  it('maps a ticked consent question to marketing consent with the form id as form version, on e-mail and SMS', async () => {
    const { service, graph, consents } = setup({ mapping: { mapping: {}, consentQuestionKey: 'marketing_ok' } });
    graph.addLead(
      lead('9001', [{ name: 'email', values: ['ada@example.com'] }, { name: 'phone_number', values: ['+4915112345678'] }, { name: 'country', values: ['DE'] }, { name: 'marketing_ok', values: ['yes'] }]),
    );
    expect(await service.processEvent('ev-1', NOW)).toBe('PROCESSED');
    // The country is passed on, so ContactConsentService applies the EU double opt-in policy (pending until the link is clicked).
    expect(consents.afterFormConsent).toHaveBeenCalledWith(STUDIO, 'contact-1', { channels: ['EMAIL', 'SMS'], formVersion: FORM, countryCode: 'DE', locale: 'en' });
  });

  it('takes the country from the phone number when the form has no country question', async () => {
    const { service, graph, consents } = setup({ mapping: { mapping: {}, consentQuestionKey: 'marketing_ok' } });
    graph.addLead(lead('9001', [{ name: 'phone_number', values: ['+33612345678'] }, { name: 'marketing_ok', values: ['yes'] }]));
    expect(await service.processEvent('ev-1', NOW)).toBe('PROCESSED');
    expect(consents.afterFormConsent).toHaveBeenCalledWith(STUDIO, 'contact-1', expect.objectContaining({ channels: ['SMS'], countryCode: 'FR' }));
  });

  it('fails for good when the lead has neither a usable phone nor an e-mail', async () => {
    const { service, graph, prisma, contacts } = setup();
    graph.addLead(lead('9001', [{ name: 'full_name', values: ['No Contact'] }, { name: 'email', values: ['not-an-email'] }]));
    expect(await service.processEvent('ev-1', NOW)).toBe('FAILED');
    expect(contacts.resolveOrCreate).not.toHaveBeenCalled();
    expect(prisma.leadAdEvent.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', nextAttemptAt: null }) }));
  });
});

describe('LeadAdsService.processEvent (failures and retry)', () => {
  it('schedules a retry after a transient Graph failure and fails after the last attempt', async () => {
    const { service, graph, prisma } = setup();
    graph.failLead('9001', 10, true);
    expect(await service.processEvent('ev-1', NOW)).toBe('RETRY');
    const first = prisma.leadAdEvent.update.mock.calls.at(-1)![0].data as { status: string; nextAttemptAt: Date };
    expect(first.status).toBe('RETRY');
    expect(first.nextAttemptAt.getTime()).toBeGreaterThan(NOW.getTime());

    prisma.leadAdEvent.findUniqueOrThrow.mockResolvedValueOnce({ id: 'ev-1', studioId: STUDIO, connectionId: 'conn-1', leadgenId: '9001', formId: FORM, pageId: PAGE, adIds: {}, createdTime: null, status: 'RETRY', attempts: LEAD_AD_MAX_ATTEMPTS, contactId: null });
    expect(await service.processEvent('ev-1', NOW)).toBe('FAILED');
  });

  it('fails at once on a permanent Graph failure such as a revoked permission', async () => {
    const { service, graph } = setup();
    graph.failLead('9001', 1, false, 403);
    expect(await service.processEvent('ev-1', NOW)).toBe('FAILED');
  });

  it('skips an event another run already claimed', async () => {
    const { service, prisma, graph } = setup();
    prisma.leadAdEvent.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await service.processEvent('ev-1', NOW)).toBe('SKIPPED');
    expect(graph.fetchCalls).toHaveLength(0);
  });
});

describe('deterministicUuid', () => {
  it('is stable per seed, distinct across seeds and a valid version 4 shape', () => {
    expect(deterministicUuid('a')).toBe(deterministicUuid('a'));
    expect(deterministicUuid('a')).not.toBe(deterministicUuid('b'));
    expect(deterministicUuid('a')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
