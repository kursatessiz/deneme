import { isPrivateOrReservedIp } from './ssrf-guard';

describe('ssrf-guard', () => {
  it('blocks IPv4 loopback', () => {
    expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
  });

  it('blocks IPv4 private ranges', () => {
    expect(isPrivateOrReservedIp('10.0.0.5')).toBe(true);
    expect(isPrivateOrReservedIp('172.16.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('172.31.255.255')).toBe(true);
    expect(isPrivateOrReservedIp('192.168.1.1')).toBe(true);
  });

  it('blocks IPv4 link-local and the cloud metadata address', () => {
    expect(isPrivateOrReservedIp('169.254.1.1')).toBe(true);
    expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true);
  });

  it('blocks CGNAT and reserved/test ranges', () => {
    expect(isPrivateOrReservedIp('100.64.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('192.0.2.1')).toBe(true);
    expect(isPrivateOrReservedIp('0.0.0.0')).toBe(true);
    expect(isPrivateOrReservedIp('224.0.0.1')).toBe(true);
  });

  it('allows a public IPv4 address', () => {
    expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false);
    expect(isPrivateOrReservedIp('1.1.1.1')).toBe(false);
  });

  it('blocks IPv6 loopback, unspecified and link-local', () => {
    expect(isPrivateOrReservedIp('::1')).toBe(true);
    expect(isPrivateOrReservedIp('::')).toBe(true);
    expect(isPrivateOrReservedIp('fe80::1')).toBe(true);
  });

  it('blocks IPv6 unique-local (fc00::/7)', () => {
    expect(isPrivateOrReservedIp('fd00::1')).toBe(true);
    expect(isPrivateOrReservedIp('fc00::1')).toBe(true);
  });

  it('blocks IPv4-mapped IPv6 addresses embedding a private IPv4', () => {
    expect(isPrivateOrReservedIp('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('::ffff:169.254.169.254')).toBe(true);
    expect(isPrivateOrReservedIp('::ffff:10.0.0.1')).toBe(true);
  });

  it('allows a public IPv6 address', () => {
    expect(isPrivateOrReservedIp('2606:4700:4700::1111')).toBe(false);
  });

  it('rejects unparseable input rather than allowing it', () => {
    expect(isPrivateOrReservedIp('not-an-ip')).toBe(true);
    expect(isPrivateOrReservedIp('')).toBe(true);
  });
});
