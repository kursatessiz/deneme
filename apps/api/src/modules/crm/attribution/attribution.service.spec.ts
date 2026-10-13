import { AttributionService } from './attribution.service';
import type { PrismaService } from '../../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

function touch(id: string, occurredAt: Date, utmSource: string | null) {
  return {
    id,
    occurredAt,
    utmSource,
    utmMedium: null,
    utmCampaign: null,
    utmId: null,
    pwCid: null,
    pwAsid: null,
    pwAdid: null,
    adPlatform: null,
    referrerHost: null,
  };
}

describe('AttributionService.refreshContactTouches', () => {
  const prisma = {
    studio: { findUnique: jest.fn() },
    touchpoint: { findFirst: jest.fn(), findMany: jest.fn() },
    contact: { updateMany: jest.fn() },
  };
  const service = new AttributionService(prisma as unknown as PrismaService);
  const at = new Date('2026-06-30T12:00:00Z');

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.studio.findUnique.mockResolvedValue({ attributionWindowDays: 30 });
  });

  it('uses two bounded queries (first asc, last desc in window) and never loads all touchpoints', async () => {
    const first = touch('t-first', new Date('2026-01-01T00:00:00Z'), 'google');
    const last = touch('t-last', new Date('2026-06-20T00:00:00Z'), 'facebook');
    prisma.touchpoint.findFirst.mockResolvedValueOnce(first).mockResolvedValueOnce(last);

    await service.refreshContactTouches('studio-1', 'contact-1', at);

    expect(prisma.touchpoint.findMany).not.toHaveBeenCalled();
    expect(prisma.touchpoint.findFirst).toHaveBeenCalledTimes(2);
    const [firstCall, lastCall] = prisma.touchpoint.findFirst.mock.calls.map((c) => c[0]);
    expect(firstCall.where).toEqual({ studioId: 'studio-1', contactId: 'contact-1', occurredAt: { lte: at } });
    expect(firstCall.orderBy[0]).toEqual({ occurredAt: 'asc' });
    expect(firstCall.select).toBeDefined();
    expect(lastCall.where).toEqual({
      studioId: 'studio-1',
      contactId: 'contact-1',
      occurredAt: { lte: at, gte: new Date(at.getTime() - 30 * DAY_MS) },
    });
    expect(lastCall.orderBy[0]).toEqual({ occurredAt: 'desc' });
    expect(lastCall.select).toBeDefined();

    const data = prisma.contact.updateMany.mock.calls[0][0].data;
    expect(prisma.contact.updateMany.mock.calls[0][0].where).toEqual({ id: 'contact-1', studioId: 'studio-1' });
    expect(data.firstTouchpointId).toBe('t-first');
    expect(data.lastTouchpointId).toBe('t-last');
  });

  it('keeps last-touch columns untouched when no touch falls in the window', async () => {
    prisma.touchpoint.findFirst
      .mockResolvedValueOnce(touch('t-old', new Date('2025-01-01T00:00:00Z'), 'google'))
      .mockResolvedValueOnce(null);

    await service.refreshContactTouches('studio-1', 'contact-1', at);

    const data = prisma.contact.updateMany.mock.calls[0][0].data;
    expect(data.firstTouchpointId).toBe('t-old');
    expect(data).not.toHaveProperty('lastTouchpointId');
  });

  it('does nothing without any touchpoint', async () => {
    prisma.touchpoint.findFirst.mockResolvedValueOnce(null);
    await service.refreshContactTouches('studio-1', 'contact-1', at);
    expect(prisma.contact.updateMany).not.toHaveBeenCalled();
    expect(prisma.touchpoint.findFirst).toHaveBeenCalledTimes(1);
  });
});
