import { Prisma } from '@platform/database';
import { ConversionService, deriveEventId } from './conversion.service';
import { ConversionOutboxService } from './conversion-outbox.service';
import { AdConnectionResolver } from './ad-connection.resolver';
import { GrowthEventsService } from '../hooks/growth-events.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AttributionService } from '../attribution/attribution.service';

const STUDIO = '0b0b0b0b-0000-4000-8000-000000000001';
const CONTACT = '0c0c0c0c-0000-4000-8000-000000000002';

function makePrisma() {
  return {
    conversionEvent: { findUnique: jest.fn(), create: jest.fn() },
    conversionDelivery: { createMany: jest.fn() },
    studio: { findUnique: jest.fn(), findFirst: jest.fn() },
    contact: { findFirst: jest.fn(), update: jest.fn() },
    membership: { findFirst: jest.fn() },
  };
}

class FixedResolver extends AdConnectionResolver {
  constructor(private readonly targets: ('META_CAPI' | 'GOOGLE_ADS')[]) {
    super();
  }
  async targetsFor() {
    return this.targets;
  }
}

describe('ConversionService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  const attribution = { lastTouchFor: jest.fn() };

  const build = (targets: ('META_CAPI' | 'GOOGLE_ADS')[] = []) => {
    const outbox = new ConversionOutboxService(prisma as unknown as PrismaService, new FixedResolver(targets));
    return new ConversionService(prisma as unknown as PrismaService, attribution as unknown as AttributionService, outbox, new GrowthEventsService());
  };

  beforeEach(() => {
    prisma = makePrisma();
    attribution.lastTouchFor.mockReset().mockResolvedValue({ id: 'tp-last' });
    prisma.studio.findUnique.mockResolvedValue({ isPlatform: false });
    prisma.contact.findFirst.mockResolvedValue({ id: CONTACT, isTest: false });
    prisma.conversionEvent.create.mockImplementation(({ data }) => Promise.resolve({ id: 'ev-1', ...data }));
  });

  const purchase = {
    studioId: STUDIO,
    type: 'purchase' as const,
    contactId: CONTACT,
    value: { amount: '1500.00', currency: 'TRY' },
    source: { kind: 'payment', id: 'pay-1' },
  };

  it('derives a stable event id from the source record', () => {
    expect(deriveEventId(STUDIO, 'purchase', 'payment', 'pay-1')).toBe(deriveEventId(STUDIO, 'purchase', 'payment', 'pay-1'));
    expect(deriveEventId(STUDIO, 'purchase', 'payment', 'pay-1')).not.toBe(deriveEventId(STUDIO, 'purchase', 'payment', 'pay-2'));
    expect(deriveEventId(STUDIO, 'purchase', 'payment', 'pay-1')).toMatch(/^purchase\.[0-9a-f]{40}$/);
  });

  it('creates the event with the last touch inside the window', async () => {
    prisma.conversionEvent.findUnique.mockResolvedValue(null);
    const result = await build().record(purchase);
    expect(result.created).toBe(true);
    const data = prisma.conversionEvent.create.mock.calls[0][0].data;
    expect(data.attributedTouchpointId).toBe('tp-last');
    expect(data.sourceKind).toBe('payment');
    expect(data.valueAmount).toEqual(new Prisma.Decimal('1500.00'));
    expect(data.currency).toBe('TRY');
  });

  it('is idempotent on the source record: a second call returns the existing row', async () => {
    prisma.conversionEvent.findUnique.mockResolvedValue({ id: 'ev-existing' });
    const result = await build().record(purchase);
    expect(result).toEqual({ event: { id: 'ev-existing' }, created: false });
    expect(prisma.conversionEvent.create).not.toHaveBeenCalled();
  });

  it('a concurrent insert that loses the unique race returns the winner', async () => {
    prisma.conversionEvent.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'ev-winner' });
    prisma.conversionEvent.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' }),
    );
    const result = await build().record(purchase);
    expect(result).toEqual({ event: { id: 'ev-winner' }, created: false });
  });

  it('platform-only events are refused outside the platform tenant', async () => {
    prisma.conversionEvent.findUnique.mockResolvedValue(null);
    await expect(
      build().record({ ...purchase, type: 'studio_signup', value: undefined, source: { kind: 'studio', id: 's1' } }),
    ).rejects.toThrow();
    expect(prisma.conversionEvent.create).not.toHaveBeenCalled();
  });

  it('a test contact makes the event a test event, which is never queued for ad platforms', async () => {
    prisma.conversionEvent.findUnique.mockResolvedValue(null);
    prisma.contact.findFirst.mockResolvedValue({ id: CONTACT, isTest: true });
    await build(['META_CAPI']).record(purchase);
    expect(prisma.conversionEvent.create.mock.calls[0][0].data.isTest).toBe(true);
    expect(prisma.conversionDelivery.createMany).not.toHaveBeenCalled();
  });

  it('queues one PENDING delivery per connected ad platform', async () => {
    prisma.conversionEvent.findUnique.mockResolvedValue(null);
    await build(['META_CAPI', 'GOOGLE_ADS', 'META_CAPI']).record(purchase);
    const rows = prisma.conversionDelivery.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(2);
    expect(rows.every((r: { status: string }) => r.status === 'PENDING')).toBe(true);
    expect(rows.map((r: { target: string }) => r.target).sort()).toEqual(['GOOGLE_ADS', 'META_CAPI']);
  });

  it('without any ad platform connection no outbox row is written', async () => {
    prisma.conversionEvent.findUnique.mockResolvedValue(null);
    await build([]).record(purchase);
    expect(prisma.conversionDelivery.createMany).not.toHaveBeenCalled();
  });

  it('recordSafely never throws', async () => {
    prisma.conversionEvent.findUnique.mockRejectedValue(new Error('db down'));
    await expect(build().recordSafely(purchase)).resolves.toBeNull();
  });

  it('rejects an invalid amount before touching the database', async () => {
    await expect(build().record({ ...purchase, value: { amount: '-1', currency: 'TRY' } })).rejects.toThrow();
    expect(prisma.conversionEvent.findUnique).not.toHaveBeenCalled();
  });

  it('studio_signup is recorded on the platform tenant only for a known owner phone', async () => {
    prisma.studio.findFirst.mockResolvedValue({ id: 'platform-id' });
    prisma.contact.findFirst.mockResolvedValueOnce(null);
    expect(await build().recordStudioSignup('new-studio', '+905550000000')).toBeNull();
    expect(prisma.conversionEvent.create).not.toHaveBeenCalled();
  });

  it('studio_paid falls back to the touchpoint the studio signup was attributed to', async () => {
    const PLATFORM = '0b0b0b0b-0000-4000-8000-0000000000ff';
    prisma.studio.findFirst.mockResolvedValue({ id: PLATFORM });
    prisma.studio.findUnique.mockResolvedValue({ isPlatform: true });
    prisma.membership.findFirst.mockResolvedValue({ user: { phone: '+905550000000' } });
    prisma.contact.findFirst.mockResolvedValue({ id: CONTACT, isTest: false });
    // No touch inside the window before the payment (a long trial).
    attribution.lastTouchFor.mockResolvedValue(null);
    prisma.conversionEvent.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(
        where.studioId_sourceKind_sourceId?.sourceKind === 'studio' ? { id: 'ev-signup', attributedTouchpointId: 'tp-signup' } : null,
      ),
    );
    const result = await build().recordStudioPaid('paid-studio', { kind: 'studio_activation', id: 'paid-studio' }, { amount: '1490.00', currency: 'TRY' });
    expect(result?.created).toBe(true);
    const data = prisma.conversionEvent.create.mock.calls[0][0].data;
    expect(data.type).toBe('studio_paid');
    expect(data.attributedTouchpointId).toBe('tp-signup');
    expect(data.sourceKind).toBe('studio_activation');
  });
});
