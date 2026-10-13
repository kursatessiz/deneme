import { isInternalPeerAddress, isInternalServerRequest } from './internal-request';

const req = (remoteAddress: string | undefined, headers: Record<string, string> = {}) => ({ headers, socket: { remoteAddress } });

describe('isInternalPeerAddress', () => {
  it.each(['127.0.0.1', '10.0.3.7', '172.18.0.4', '192.168.1.2', '::1', '::ffff:172.18.0.4', 'fd00::5'])('treats %s as internal', (ip) => {
    expect(isInternalPeerAddress(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '172.32.0.1', '100.64.0.1', '::ffff:8.8.8.8', '2001:db8::1', 'not-an-ip', undefined])('treats %s as external', (ip) => {
    expect(isInternalPeerAddress(ip)).toBe(false);
  });
});

describe('isInternalServerRequest', () => {
  it('is true for a private peer without X-Forwarded-For (the web container calling the API directly)', () => {
    expect(isInternalServerRequest(req('::ffff:172.18.0.5'))).toBe(true);
  });

  it('is false whenever X-Forwarded-For is present (every request through Caddy)', () => {
    expect(isInternalServerRequest(req('::ffff:172.18.0.2', { 'x-forwarded-for': '203.0.113.9' }))).toBe(false);
    // Even a spoofed private value in the header is still counted (by the address Express derives from it).
    expect(isInternalServerRequest(req('::ffff:172.18.0.2', { 'x-forwarded-for': '10.0.0.1' }))).toBe(false);
  });

  it('is false for a public peer without the header', () => {
    expect(isInternalServerRequest(req('198.51.100.7'))).toBe(false);
  });

  it('is false without a known peer address', () => {
    expect(isInternalServerRequest(req(undefined))).toBe(false);
  });
});
