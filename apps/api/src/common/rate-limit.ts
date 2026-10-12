import { isIP } from 'node:net';

/** Upper bound on one in-memory fallback counter map before it is swept. */
export const MEMORY_COUNTER_LIMIT = 10_000;

/**
 * Rate-limit key for a client address. IPv4 stays as is. An IPv6 address is
 * reduced to its /64 prefix, because one subscriber commonly controls a whole
 * /64 and could otherwise mint a fresh key per request. IPv4-mapped IPv6
 * addresses are keyed by their IPv4 address. An unusable value maps to
 * 'unknown'.
 */
export function clientIpKey(ip: string | null | undefined): string {
  if (!ip) return 'unknown';
  const bare = ip.split('%')[0].trim().toLowerCase();
  const version = isIP(bare);
  if (version === 4) return bare;
  if (version !== 6) return 'unknown';

  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(bare);
  if (mapped) return mapped[1];

  // Turn a trailing dotted IPv4 into two hex groups so every form has 8 groups.
  let text = bare;
  const tail = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number);
    text = `${text.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, rest] = text.split('::');
  const headGroups = head ? head.split(':') : [];
  const restGroups = rest !== undefined && rest !== '' ? rest.split(':') : [];
  const missing = text.includes('::') ? 8 - headGroups.length - restGroups.length : 0;
  const groups = [...headGroups, ...Array<string>(Math.max(missing, 0)).fill('0'), ...restGroups];
  if (groups.length !== 8) return 'unknown';
  return `${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':')}::/64`;
}

/**
 * Keeps an in-memory fixed-window counter map bounded: once it reaches
 * `maxEntries`, expired windows are dropped, and if it is still full the
 * oldest entries go too. Cheap when the map is small.
 */
export function pruneExpiredCounters(map: Map<string, { resetAt: number }>, now: number, maxEntries = MEMORY_COUNTER_LIMIT): void {
  if (map.size < maxEntries) return;
  for (const [key, entry] of map) if (entry.resetAt <= now) map.delete(key);
  for (const key of map.keys()) {
    if (map.size < maxEntries) break;
    map.delete(key);
  }
}
