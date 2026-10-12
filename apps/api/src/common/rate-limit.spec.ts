import { clientIpKey, pruneExpiredCounters } from './rate-limit';

describe('clientIpKey', () => {
  it('keeps IPv4 addresses and maps IPv4-mapped IPv6 to IPv4', () => {
    expect(clientIpKey('203.0.113.7')).toBe('203.0.113.7');
    expect(clientIpKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('keys every address of one IPv6 /64 the same way', () => {
    const a = clientIpKey('2001:db8:abcd:12::1');
    expect(a).toBe('2001:db8:abcd:12::/64');
    expect(clientIpKey('2001:0db8:abcd:0012:ffff:ffff:ffff:ffff')).toBe(a);
    expect(clientIpKey('2001:DB8:ABCD:12:1:2:3:4')).toBe(a);
    expect(clientIpKey('2001:db8:abcd:13::1')).not.toBe(a);
  });

  it('handles compressed and short forms', () => {
    expect(clientIpKey('::1')).toBe('0:0:0:0::/64');
    expect(clientIpKey('2001:db8::')).toBe('2001:db8:0:0::/64');
    expect(clientIpKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
  });

  it('falls back to unknown', () => {
    expect(clientIpKey(undefined)).toBe('unknown');
    expect(clientIpKey('')).toBe('unknown');
    expect(clientIpKey('not an ip')).toBe('unknown');
  });
});

describe('pruneExpiredCounters', () => {
  it('drops expired windows once the map is full', () => {
    const map = new Map<string, { resetAt: number }>();
    for (let i = 0; i < 10; i += 1) map.set(`old-${i}`, { resetAt: 100 });
    for (let i = 0; i < 5; i += 1) map.set(`live-${i}`, { resetAt: 10_000 });
    pruneExpiredCounters(map, 1_000, 15);
    expect([...map.keys()].every((k) => k.startsWith('live-'))).toBe(true);
    expect(map.size).toBe(5);
  });

  it('evicts the oldest live entries when everything is still live', () => {
    const map = new Map<string, { resetAt: number }>();
    for (let i = 0; i < 20; i += 1) map.set(`k${i}`, { resetAt: 10_000 });
    pruneExpiredCounters(map, 1_000, 10);
    expect(map.size).toBe(9);
    expect(map.has('k19')).toBe(true);
    expect(map.has('k0')).toBe(false);
  });

  it('does nothing below the limit', () => {
    const map = new Map<string, { resetAt: number }>([['a', { resetAt: 1 }]]);
    pruneExpiredCounters(map, 1_000, 10);
    expect(map.size).toBe(1);
  });
});
