import { signTrackingToken, verifyTrackingToken } from './tracking-tokens';
import { TrackingService, isMachineFetch, maskAddress } from './tracking.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { MessagingUrls } from './messaging-urls.service';
import type { AttributionService } from '../../crm/attribution/attribution.service';
import type { OptOutService } from '../engine/opt-out.service';

const SECRET = 'test-secret-test-secret-test-secret-00';
const ID = '11111111-2222-4333-8444-555555555555';

describe('tracking tokens', () => {
  it('round-trips a signed reference', () => {
    const token = signTrackingToken(SECRET, 'c', ID);
    expect(verifyTrackingToken(SECRET, token, 'c')).toBe(ID);
  });

  it('rejects a token of another kind, another secret, or a tampered payload/mac', () => {
    const token = signTrackingToken(SECRET, 'o', ID);
    expect(verifyTrackingToken(SECRET, token, 'u')).toBeNull();
    expect(verifyTrackingToken('another-secret-another-secret-0000', token, 'o')).toBeNull();
    const [payload, mac] = token.split('.');
    const forged = Buffer.from(`v1:o:${ID.replace('1', '9')}`).toString('base64url');
    expect(verifyTrackingToken(SECRET, `${forged}.${mac}`, 'o')).toBeNull();
    expect(verifyTrackingToken(SECRET, `${payload}.${mac.slice(0, -2)}AA`, 'o')).toBeNull();
    expect(verifyTrackingToken(SECRET, `${payload}`, 'o')).toBeNull();
    expect(verifyTrackingToken(SECRET, 'a.b.c', 'o')).toBeNull();
    expect(verifyTrackingToken('', token, 'o')).toBeNull();
  });

  it('cannot carry a URL: only uuid references are signed or accepted', () => {
    expect(() => signTrackingToken(SECRET, 'c', 'https://evil.example.com')).toThrow();
    // A correctly MAC'd payload whose id is a URL is still refused.
    const payload = 'v1:c:https://evil.example.com';
    const { createHmac } = jest.requireActual<typeof import('crypto')>('crypto');
    const mac = createHmac('sha256', SECRET).update(payload).digest('base64url');
    expect(verifyTrackingToken(SECRET, `${Buffer.from(payload).toString('base64url')}.${mac}`, 'c')).toBeNull();
  });
});

describe('TrackingService.recordClick (no open redirect)', () => {
  const urls = {
    verify: (token: string, kind: 'o' | 'c' | 'u') => verifyTrackingToken(SECRET, token, kind),
  } as unknown as MessagingUrls;
  const identify = jest.fn();
  const link = {
    id: ID,
    studioId: 'studio-1',
    notificationLogId: 'log-1',
    url: 'https://studio.example.com/offer',
    notificationLog: { contactId: 'contact-1', clickedAt: null },
  };
  const prisma = {
    messageLink: { findUnique: jest.fn(async ({ where }: { where: { id: string } }) => (where.id === ID ? link : null)) },
    messageTrackingEvent: { create: jest.fn() },
    notificationLog: { update: jest.fn() },
  } as unknown as PrismaService;
  const service = new TrackingService(prisma, urls, { identify } as unknown as AttributionService, {} as OptOutService);

  beforeEach(() => jest.clearAllMocks());

  it('redirects only to the stored target and links the visitor for attribution', async () => {
    const url = await service.recordClick(signTrackingToken(SECRET, 'c', ID), 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1', 'vis-1');
    expect(url).toBe('https://studio.example.com/offer');
    expect(identify).toHaveBeenCalledWith('studio-1', 'vis-1', 'contact-1');
  });

  it('returns null for a forged, wrong-kind or unknown token (caller then goes to the site root)', async () => {
    expect(await service.recordClick('not-a-token', undefined, null)).toBeNull();
    expect(await service.recordClick(signTrackingToken(SECRET, 'u', ID), undefined, null)).toBeNull();
    expect(await service.recordClick(signTrackingToken(SECRET, 'c', '99999999-2222-4333-8444-555555555555'), undefined, null)).toBeNull();
  });

  it('a scanner click is recorded as machine and never attributed', async () => {
    await service.recordClick(signTrackingToken(SECRET, 'c', ID), 'Mozilla/5.0 (compatible; Barracuda Sentinel)', 'vis-1');
    expect(identify).not.toHaveBeenCalled();
    expect((prisma.messageTrackingEvent.create as jest.Mock).mock.calls[0][0].data.isMachine).toBe(true);
  });
});

describe('machine opens and address masking', () => {
  it('marks Apple Mail Privacy Protection and scanners as machine', () => {
    expect(isMachineFetch('Mozilla/5.0')).toEqual({ machine: true, detail: 'apple_mpp' });
    expect(isMachineFetch(undefined).machine).toBe(true);
    expect(isMachineFetch('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36').machine).toBe(false);
  });

  it('masks email and phone', () => {
    expect(maskAddress('EMAIL', 'ada@example.com')).toBe('a***@example.com');
    expect(maskAddress('SMS', '+905321000016')).toBe('*********0016');
  });
});
