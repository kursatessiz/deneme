import { ConversionDeliveryDispatcherService } from './conversion-delivery-dispatcher.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CredentialCipher } from '../../../common/crypto/credential-cipher';
import { AdsHttpClient } from '../ads-http-client';

function baseDelivery(overrides: Record<string, unknown> = {}) {
  return {
    id: 'delivery-1',
    studioId: 'studio-1',
    target: 'META_CAPI',
    status: 'PENDING',
    attempts: 0,
    conversionEvent: {
      eventId: 'lead.abc',
      type: 'lead',
      occurredAt: new Date('2026-09-28T10:00:00Z'),
      valueAmount: null,
      currency: null,
      contact: {
        id: 'contact-1',
        firstName: 'Ayşe',
        lastName: 'Yılmaz',
        phone: '+905321112233',
        email: 'ayse@example.com',
        countryCode: 'TR',
      },
      attributedTouchpoint: {
        occurredAt: new Date('2026-09-20T10:00:00Z'),
        advertisingConsent: true,
        landingHost: 'demo.example.com',
        landingPath: '/tr/pilates',
        fbp: 'fb.1.1.1',
        fbc: 'fb.1.1.fbclid',
        gclid: null,
        gbraid: null,
        wbraid: null,
        ttclid: null,
      },
      studio: { timezone: 'Europe/Istanbul' },
    },
    ...overrides,
  };
}

describe('ConversionDeliveryDispatcherService', () => {
  let prisma: any;
  let cipher: Pick<CredentialCipher, 'decrypt'>;
  let http: { postJson: jest.Mock; getJson: jest.Mock };
  let service: ConversionDeliveryDispatcherService;

  beforeEach(() => {
    prisma = {
      conversionDelivery: { findMany: jest.fn(), update: jest.fn((args: any) => ({ ...args.data, id: args.where.id })), findUniqueOrThrow: jest.fn() },
      adConnection: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'conn-1',
          platform: 'META',
          externalAccountId: 'act_1',
          pixelOrDatasetId: '999',
          conversionActionIds: {},
          isTestMode: false,
          encryptedCredentials: 'encrypted',
        }),
      },
    };
    cipher = { decrypt: jest.fn().mockReturnValue(JSON.stringify({ accessToken: 'token123', pixelId: '123456789012345' })) };
    http = { postJson: jest.fn(), getJson: jest.fn() };
    service = new ConversionDeliveryDispatcherService(prisma as unknown as PrismaService, cipher as CredentialCipher, http as unknown as AdsHttpClient);
  });

  it('marks a delivery SENT on a successful platform response', async () => {
    prisma.conversionDelivery.findMany.mockResolvedValue([baseDelivery()]);
    http.postJson.mockResolvedValue({ ok: true, status: 200, body: { events_received: 1 } });

    const outcome = await service.dispatchDue();

    expect(outcome).toEqual({ attempted: 1, sent: 1, skipped: 0, retrying: 0, failed: 0 });
    expect(prisma.conversionDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'delivery-1' }, data: expect.objectContaining({ status: 'SENT' }) }),
    );
  });

  it('schedules a retry with the configured backoff on the first few failures, reusing the same row', async () => {
    prisma.conversionDelivery.findMany.mockResolvedValue([baseDelivery({ attempts: 0 })]);
    prisma.conversionDelivery.findUniqueOrThrow.mockResolvedValue({ attempts: 0 });
    http.postJson.mockResolvedValue({ ok: false, status: 500, body: { error: 'boom' } });

    const before = Date.now();
    const outcome = await service.dispatchDue();

    expect(outcome.retrying).toBe(1);
    const call = prisma.conversionDelivery.update.mock.calls[0][0];
    expect(call.data.status).toBe('PENDING');
    expect(call.data.attempts).toBe(1);
    // First retry delay is 60s (CONVERSION_RETRY_DELAYS_SECONDS[0]).
    expect(call.data.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(before + 59_000);
    expect(call.data.nextAttemptAt.getTime()).toBeLessThanOrEqual(before + 61_000);
  });

  it('dead-letters (FAILED, no further retry) once attempts are exhausted', async () => {
    prisma.conversionDelivery.findMany.mockResolvedValue([baseDelivery({ attempts: 4 })]);
    prisma.conversionDelivery.findUniqueOrThrow.mockResolvedValue({ attempts: 4 });
    http.postJson.mockResolvedValue({ ok: false, status: 500, body: { error: 'boom' } });

    const outcome = await service.dispatchDue();

    expect(outcome.failed).toBe(1);
    const call = prisma.conversionDelivery.update.mock.calls[0][0];
    expect(call.data.status).toBe('FAILED');
    expect(call.data.nextAttemptAt).toBeNull();
  });

  it('skips with SKIPPED_NO_CONSENT without ever calling the HTTP client', async () => {
    prisma.conversionDelivery.findMany.mockResolvedValue([
      baseDelivery({ conversionEvent: { ...baseDelivery().conversionEvent, attributedTouchpoint: null } }),
    ]);

    const outcome = await service.dispatchDue();

    expect(outcome.skipped).toBe(1);
    expect(http.postJson).not.toHaveBeenCalled();
    expect(prisma.conversionDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SKIPPED_NO_CONSENT' }) }),
    );
  });

  it('dead-letters immediately when the tenant has no connected account for the target platform', async () => {
    prisma.adConnection.findFirst.mockResolvedValue(null);
    prisma.conversionDelivery.findMany.mockResolvedValue([baseDelivery()]);

    const outcome = await service.dispatchDue();

    expect(outcome.failed).toBe(1);
    expect(http.postJson).not.toHaveBeenCalled();
  });
});
