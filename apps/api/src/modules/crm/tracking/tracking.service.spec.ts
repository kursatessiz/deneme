import type { TouchpointInput } from '@platform/shared';
import { TrackingService } from './tracking.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AttributionService } from '../attribution/attribution.service';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const VID = '11111111-2222-4333-8444-555555555555';
const SID = '66666666-7777-4888-9999-aaaaaaaaaaaa';

function input(overrides: Partial<TouchpointInput> = {}): TouchpointInput {
  return {
    visitorId: VID,
    sessionId: SID,
    landingUrl:
      'https://site.example/tr/pilates?utm_source=facebook&utm_medium=paid_social&pw_cid=c1&pw_asid=as1&pw_adid=ad1&fbclid=FB123',
    referrer: 'https://l.facebook.com/',
    utm: {},
    adIds: {},
    clickIds: {},
    fbp: 'fb.1.123.456',
    fbc: 'fb.1.123.FB123',
    locale: 'tr',
    consent: { analytics: true, advertising: true },
    ...overrides,
  };
}

describe('TrackingService consent gating', () => {
  const prisma = {
    studio: { findFirst: jest.fn() },
    visitor: { upsert: jest.fn() },
    touchpoint: { create: jest.fn() },
  };
  const attribution = { refreshContactTouches: jest.fn() };
  const service = new TrackingService(prisma as unknown as PrismaService, attribution as unknown as AttributionService);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.studio.findFirst.mockResolvedValue({ id: 'studio-1' });
    prisma.visitor.upsert.mockResolvedValue({ id: VID, contactId: null });
    prisma.touchpoint.create.mockResolvedValue({ id: 'tp-1' });
  });

  it('stores nothing at all without analytics consent', async () => {
    const outcome = await service.recordTouchpoint(
      'zen',
      input({ consent: { analytics: false, advertising: true } }),
      { userAgent: UA, headers: {} },
    );
    expect(outcome).toBe('no_consent');
    expect(prisma.studio.findFirst).not.toHaveBeenCalled();
    expect(prisma.visitor.upsert).not.toHaveBeenCalled();
    expect(prisma.touchpoint.create).not.toHaveBeenCalled();
  });

  it('ignores bots', async () => {
    const outcome = await service.recordTouchpoint('zen', input(), { userAgent: 'Googlebot/2.1', headers: {} });
    expect(outcome).toBe('bot');
    expect(prisma.touchpoint.create).not.toHaveBeenCalled();
  });

  it('drops click ids and Meta cookies without advertising consent but keeps campaign ids', async () => {
    await service.recordTouchpoint('zen', input({ consent: { analytics: true, advertising: false } }), {
      userAgent: UA,
      headers: {},
    });
    const data = prisma.touchpoint.create.mock.calls[0][0].data;
    expect(data.fbclid).toBeNull();
    expect(data.fbp).toBeNull();
    expect(data.fbc).toBeNull();
    expect(data.pwCid).toBe('c1');
    expect(data.utmSource).toBe('facebook');
    expect(data.adPlatform).toBe('META');
  });

  it('stores click ids with advertising consent and never the query string or IP', async () => {
    await service.recordTouchpoint('zen', input(), { userAgent: UA, headers: { 'cf-ipcountry': 'TR', 'x-forwarded-for': '9.9.9.9' } });
    const data = prisma.touchpoint.create.mock.calls[0][0].data;
    expect(data.fbclid).toBe('FB123');
    expect(data.fbp).toBe('fb.1.123.456');
    expect(data.landingPath).toBe('/tr/pilates');
    expect(data.landingHost).toBe('site.example');
    expect(data.referrerHost).toBe('l.facebook.com');
    expect(data.countryCode).toBe('TR');
    expect(JSON.stringify(data)).not.toContain('9.9.9.9');
    expect(JSON.stringify(data)).not.toContain('utm_source=');
    expect(data.isPaidUntagged).toBe(false);
  });

  it('flags paid traffic without our ad ids as untagged', async () => {
    await service.recordTouchpoint('zen', input({ landingUrl: 'https://site.example/?gclid=G1' }), { userAgent: UA, headers: {} });
    const data = prisma.touchpoint.create.mock.calls[0][0].data;
    expect(data.isPaidUntagged).toBe(true);
    expect(data.adPlatform).toBe('GOOGLE');
  });

  it('an unknown studio stores nothing', async () => {
    prisma.studio.findFirst.mockResolvedValueOnce(null);
    const outcome = await service.recordTouchpoint('nope', input(), { userAgent: UA, headers: {} });
    expect(outcome).toBe('unknown_studio');
    expect(prisma.visitor.upsert).not.toHaveBeenCalled();
  });

  it('attaches the touch of an identified visitor to its contact', async () => {
    prisma.visitor.upsert.mockResolvedValueOnce({ id: VID, contactId: 'contact-1' });
    await service.recordTouchpoint('zen', input(), { userAgent: UA, headers: {} });
    expect(prisma.touchpoint.create.mock.calls[0][0].data.contactId).toBe('contact-1');
    expect(attribution.refreshContactTouches).toHaveBeenCalledWith('studio-1', 'contact-1', expect.any(Date));
  });
});
