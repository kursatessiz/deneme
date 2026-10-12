import { EventEmitter } from 'node:events';
import { fetchLogoDataUri, isPublicHttpsUrl } from './logo';

const mockLookup = jest.fn();
const mockRequest = jest.fn();
jest.mock('node:dns/promises', () => ({ lookup: (...args: unknown[]) => mockLookup(...args) }));
jest.mock('node:https', () => ({ request: (...args: unknown[]) => mockRequest(...args) }));

describe('isPublicHttpsUrl', () => {
  it('accepts a plain public https URL', () => {
    expect(isPublicHttpsUrl('https://cdn.example.com/logo.png')).toBe(true);
    expect(isPublicHttpsUrl('https://cdn.example.com:443/logo.png')).toBe(true);
  });

  it('rejects other schemes, credentials and internal hosts', () => {
    expect(isPublicHttpsUrl('http://cdn.example.com/logo.png')).toBe(false);
    expect(isPublicHttpsUrl('https://user:pw@cdn.example.com/logo.png')).toBe(false);
    expect(isPublicHttpsUrl('https://localhost/logo.png')).toBe(false);
    expect(isPublicHttpsUrl('https://api/logo.png')).toBe(false);
    expect(isPublicHttpsUrl('https://127.0.0.1/logo.png')).toBe(false);
    expect(isPublicHttpsUrl('https://[::1]/logo.png')).toBe(false);
    expect(isPublicHttpsUrl('https://db.internal/logo.png')).toBe(false);
    expect(isPublicHttpsUrl('not a url')).toBe(false);
  });

  it('rejects any port other than 443', () => {
    expect(isPublicHttpsUrl('https://cdn.example.com:8443/logo.png')).toBe(false);
    expect(isPublicHttpsUrl('https://cdn.example.com:22/logo.png')).toBe(false);
  });
});

describe('fetchLogoDataUri', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    mockLookup.mockReset();
    mockRequest.mockReset();
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network disabled in test'));
  });
  afterEach(() => fetchSpy.mockRestore());

  it('does not connect when the hostname resolves to a private address', async () => {
    mockLookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    expect(await fetchLogoDataUri('https://cdn.example.com/logo.png')).toBeNull();
    expect(mockRequest).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not connect when any of several resolved addresses is private', async () => {
    mockLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]);
    expect(await fetchLogoDataUri('https://cdn.example.com/logo.png')).toBeNull();
    expect(mockRequest).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not connect to a non-443 port', async () => {
    expect(await fetchLogoDataUri('https://cdn.example.com:8443/logo.png')).toBeNull();
    expect(mockLookup).not.toHaveBeenCalled();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('pins the connection to the validated address and returns a data URI', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    let pinned: { address: string; family: number } | null = null;
    mockRequest.mockImplementation((_url: URL, options: { lookup: (h: string, o: object, cb: (e: null, a: string, f: number) => void) => void }, onResponse: (res: EventEmitter & { statusCode: number; headers: Record<string, string>; destroy: () => void }) => void) => {
      options.lookup('cdn.example.com', {}, (_e, address, family) => {
        pinned = { address, family };
      });
      const req = Object.assign(new EventEmitter(), { end: () => undefined, destroy: () => undefined });
      const res = Object.assign(new EventEmitter(), { statusCode: 200, headers: { 'content-type': 'image/png' }, destroy: () => undefined });
      setImmediate(() => {
        onResponse(res);
        res.emit('data', Buffer.from('png-bytes'));
        res.emit('end');
      });
      return req;
    });
    const result = await fetchLogoDataUri('https://cdn.example.com/logo.png');
    expect(result).toBe(`data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`);
    expect(pinned).toEqual({ address: '93.184.216.34', family: 4 });
  });
});
