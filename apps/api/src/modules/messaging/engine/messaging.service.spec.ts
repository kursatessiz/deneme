import type { ConfigService } from '@nestjs/config';
import { MessagingService } from './messaging.service';
import { TemplateResolver } from './template-resolver.service';
import { ComplianceService } from '../../compliance/compliance.service';
import { MessagingUrls } from '../tracking/messaging-urls.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ContactConsentService } from '../../notifications/consent/contact-consent.service';
import type { NotificationPreferencesService } from '../../notifications/notification-preferences.service';
import type { PushService } from '../../notifications/push.service';
import type { MessagingChannelRegistry } from '../channels/channel-registry.service';
import type { OptOutService } from './opt-out.service';

/**
 * Engine decisions with the database mocked: quiet hours apply to
 * commercial messages only, consent and suppression gate commercial sends,
 * the per-contact frequency cap, idempotency, locale fallback and channel
 * fallback. Istanbul is UTC+3 all year.
 */
const STUDIO = {
  id: 'studio-1',
  name: 'Zen',
  email: 'hello@zen.example',
  address: 'Moda Cad. 1, İstanbul',
  timezone: 'Europe/Istanbul',
  countryCode: 'TR',
  defaultLocale: 'tr',
  logoUrl: null,
  themeFamily: 'atolye',
  themePrimary: '#2F6F5E',
  gradientPresetKey: 'atolye-orman',
  notificationSettings: { order: ['WHATSAPP', 'SMS'], whatsappEnabled: true },
  messagingSettings: {},
};

function contactRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'contact-1',
    firstName: 'Ada',
    phone: '+905321000016',
    email: 'ada@example.com',
    locale: null,
    countryCode: 'TR',
    timezone: null,
    membershipId: 'm-1',
    membership: { user: { id: 'user-1', phone: '+905321000016', email: null, locale: null } },
    ...overrides,
  };
}

function setup(opts: { consent?: boolean; suppressed?: boolean; counts?: [number, number]; whatsappFails?: boolean; prior?: unknown } = {}) {
  let seq = 0;
  const logs: Record<string, unknown>[] = [];
  const prisma = {
    studio: { findUnique: jest.fn(async () => STUDIO) },
    contact: { findFirst: jest.fn(async () => contactRow()) },
    messageTemplate: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
    notificationLog: {
      count: jest.fn(async ({ where }: { where: { createdAt: { gte: Date } } }) => {
        const [day, week] = opts.counts ?? [0, 0];
        const spanMs = Date.now() - where.createdAt.gte.getTime();
        return spanMs > 2 * 24 * 3600 * 1000 ? week : day;
      }),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `log-${++seq}`, ...data };
        logs.push(row);
        return row;
      }),
      update: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: 1 })),
      findFirst: jest.fn(async () => opts.prior ?? null),
      findMany: jest.fn(async () => []),
    },
    smsWallet: {
      findUnique: jest.fn(async () => ({ id: 'w-1', balance: 5 })),
      updateMany: jest.fn(async () => ({ count: 1 })),
      findUniqueOrThrow: jest.fn(async () => ({ balance: 4 })),
    },
    smsTransaction: { create: jest.fn() },
    messageLink: { create: jest.fn() },
  };
  const smsAdapter = { key: 'NETGSM', isConfigured: () => true, send: jest.fn(async (_req: Record<string, unknown>) => ({ success: true, providerMessageId: 'sms-1' })) };
  const whatsapp = {
    key: 'WHATSAPP_CLOUD',
    isConfigured: () => true,
    send: jest.fn(async (_req: Record<string, unknown>) => (opts.whatsappFails ? { success: false, errorMessage: 'wa down' } : { success: true, providerMessageId: 'wa-1' })),
  };
  const email = { key: 'SES', isConfigured: () => false, send: jest.fn() };
  const registry = { resolveSms: jest.fn(() => smsAdapter), resolveWhatsApp: () => whatsapp, resolveEmail: () => email, whatsapp, email };
  const consents = {
    commercialFacts: jest.fn(async () => ({
      policy: null,
      consent: opts.consent
        ? { decision: 'GRANTED', decidedBy: 'contact', legalBasis: null, confirmationRequested: false, confirmed: false }
        : { decision: 'NONE', decidedBy: 'default', legalBasis: null, confirmationRequested: false, confirmed: false },
      isBusiness: false,
      isExistingCustomer: false,
    })),
    applyMerchantExemption: jest.fn(async () => 0),
  };
  const optOut = { isSuppressed: jest.fn(async () => opts.suppressed ?? false) };
  const config = { get: jest.fn((key: string, fallback?: string) => ({ JWT_SECRET: 'x'.repeat(40), NODE_ENV: 'test' })[key] ?? fallback) };
  const service = new MessagingService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
    new ComplianceService(),
    consents as unknown as ContactConsentService,
    { channelsFor: jest.fn(async () => ({ push: true, sms: true })) } as unknown as NotificationPreferencesService,
    { hasDevices: jest.fn(async () => true), sendToUser: jest.fn(async () => 1) } as unknown as PushService,
    registry as unknown as MessagingChannelRegistry,
    new TemplateResolver(prisma as unknown as PrismaService),
    optOut as unknown as OptOutService,
    new MessagingUrls(config as unknown as ConfigService),
  );
  return { service, prisma, logs, smsAdapter, whatsapp };
}

describe('MessagingService.send', () => {
  afterEach(() => jest.useRealTimers());

  const at = (iso: string) => jest.useFakeTimers({ now: new Date(iso), doNotFake: ['nextTick', 'setImmediate'] });

  it('sends a transactional reminder at 03:00 local time: quiet hours do not apply', async () => {
    at('2026-06-15T00:00:00.000Z'); // 03:00 in Istanbul
    const { service, whatsapp } = setup();
    const result = await service.send({
      studioId: 'studio-1',
      recipient: { contactId: 'contact-1' },
      templateKey: 'BOOKING_REMINDER',
      variables: { serviceName: 'Reformer', startTime: '10:00' },
    });
    expect(result).toMatchObject({ success: true, channel: 'WHATSAPP' });
    expect(whatsapp.send.mock.calls[0][0]).toMatchObject({ whatsappTemplateName: 'booking_reminder_tr', languageCode: 'tr' });
  });

  it('holds a commercial message in quiet hours even with consent', async () => {
    at('2026-06-15T00:00:00.000Z');
    const { service, prisma } = setup({ consent: true });
    const result = await service.send({ studioId: 'studio-1', recipient: { contactId: 'contact-1' }, templateKey: 'WIN_BACK' });
    expect(result).toMatchObject({ success: false, reasonCode: 'QUIET_HOURS' });
    expect(prisma.notificationLog.create).not.toHaveBeenCalled();
  });

  it('needs recorded consent for a commercial message', async () => {
    at('2026-06-15T09:00:00.000Z'); // 12:00 Istanbul
    const { service } = setup({ consent: false });
    const result = await service.send({ studioId: 'studio-1', recipient: { contactId: 'contact-1' }, templateKey: 'WIN_BACK' });
    expect(result).toMatchObject({ success: false, reasonCode: 'CONSENT_REQUIRED' });
  });

  it('treats a caller-declared commercial purpose as commercial even for a transactional template', async () => {
    at('2026-06-15T09:00:00.000Z');
    const { service } = setup({ consent: false });
    const result = await service.send({
      studioId: 'studio-1',
      recipient: { contactId: 'contact-1' },
      templateKey: 'BOOKING_REMINDER',
      purpose: 'COMMERCIAL',
      variables: { serviceName: 'x', startTime: 'y' },
    });
    expect(result.reasonCode).toBe('CONSENT_REQUIRED');
  });

  it('suppressed addresses (unsubscribe, bounce) get no commercial message', async () => {
    at('2026-06-15T09:00:00.000Z');
    const { service } = setup({ consent: true, suppressed: true });
    const result = await service.send({ studioId: 'studio-1', recipient: { contactId: 'contact-1' }, templateKey: 'WIN_BACK' });
    expect(result).toMatchObject({ success: false, reasonCode: 'OPTED_OUT' });
  });

  it('applies the per-contact frequency cap to commercial messages (3 a day, 10 a week by default)', async () => {
    at('2026-06-15T09:00:00.000Z');
    expect((await setup({ consent: true, counts: [3, 3] }).service.send({ studioId: 'studio-1', recipient: { contactId: 'contact-1' }, templateKey: 'WIN_BACK' })).reasonCode).toBe(
      'FREQUENCY_CAP',
    );
    expect((await setup({ consent: true, counts: [0, 10] }).service.send({ studioId: 'studio-1', recipient: { contactId: 'contact-1' }, templateKey: 'WIN_BACK' })).reasonCode).toBe(
      'FREQUENCY_CAP',
    );
    const ok = await setup({ consent: true, counts: [2, 9] }).service.send({ studioId: 'studio-1', recipient: { contactId: 'contact-1' }, templateKey: 'WIN_BACK' });
    expect(ok.success).toBe(true);
  });

  it('transactional messages ignore the frequency cap', async () => {
    at('2026-06-15T09:00:00.000Z');
    const { service } = setup({ counts: [99, 99] });
    const result = await service.send({
      studioId: 'studio-1',
      recipient: { contactId: 'contact-1' },
      templateKey: 'BOOKING_REMINDER',
      variables: { serviceName: 'x', startTime: 'y' },
    });
    expect(result.success).toBe(true);
  });

  it('falls back from WhatsApp to SMS, charging one credit and chaining the attempt', async () => {
    at('2026-06-15T09:00:00.000Z');
    const { service, logs, prisma } = setup({ whatsappFails: true });
    const result = await service.send({
      studioId: 'studio-1',
      recipient: { contactId: 'contact-1' },
      templateKey: 'BOOKING_REMINDER',
      variables: { serviceName: 'x', startTime: 'y' },
    });
    expect(result).toMatchObject({ success: true, channel: 'SMS' });
    expect(logs.map((l) => l.channel)).toEqual(['WHATSAPP', 'SMS']);
    expect(logs[1].fallbackOfId).toBe(logs[0].id);
    expect(prisma.smsTransaction.create).toHaveBeenCalledTimes(1);
  });

  it('returns the earlier result for a used idempotency key without sending again', async () => {
    at('2026-06-15T09:00:00.000Z');
    const { service, whatsapp, smsAdapter } = setup({ prior: { id: 'old', status: 'SENT', channel: 'SMS', providerMessageId: 'p-1' } });
    const result = await service.send({
      studioId: 'studio-1',
      recipient: { contactId: 'contact-1' },
      templateKey: 'BOOKING_REMINDER',
      variables: { serviceName: 'x', startTime: 'y' },
      idempotencyKey: 'booking-1-reminder',
    });
    expect(result).toMatchObject({ success: true, duplicate: true, notificationLogId: 'old' });
    expect(whatsapp.send).not.toHaveBeenCalled();
    expect(smsAdapter.send).not.toHaveBeenCalled();
  });

  it('renders in the recipient language, falling back per template', async () => {
    at('2026-06-15T09:00:00.000Z');
    const { service, prisma, smsAdapter } = setup();
    prisma.contact.findFirst.mockResolvedValueOnce(contactRow({ locale: 'en' }));
    await service.send({
      studioId: 'studio-1',
      recipient: { contactId: 'contact-1' },
      channel: 'SMS',
      templateKey: 'BOOKING_REMINDER',
      variables: { serviceName: 'Reformer', startTime: '10:00' },
    });
    expect(smsAdapter.send.mock.calls[0][0]).toMatchObject({ body: 'Hi Ada, your Reformer session starts at 10:00.' });
  });

  it('skips a channel whose template is missing a variable instead of sending half a message', async () => {
    at('2026-06-15T09:00:00.000Z');
    const { service, smsAdapter } = setup();
    const result = await service.send({ studioId: 'studio-1', recipient: { contactId: 'contact-1' }, channel: 'SMS', templateKey: 'BOOKING_REMINDER' });
    expect(result).toMatchObject({ success: false, reasonCode: 'RENDER_ERROR' });
    expect(smsAdapter.send).not.toHaveBeenCalled();
  });
});
