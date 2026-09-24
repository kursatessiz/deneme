/**
 * Headers that must never be copied between the browser <-> BFF <-> API
 * hops: connection-management headers are specific to one TCP hop, and
 * `host`/`cookie`/`authorization`/`content-length` are rebuilt explicitly by
 * the proxy instead of being forwarded blindly.
 */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'cookie',
  'authorization',
  'content-length',
]);

export function isHopByHopHeader(name: string): boolean {
  return HOP_BY_HOP.has(name.toLowerCase());
}

/** Copies every header except hop-by-hop ones from `source` into a new Headers. */
export function stripHopByHopHeaders(source: Headers): Headers {
  const out = new Headers();
  source.forEach((value, key) => {
    if (!isHopByHopHeader(key)) out.set(key, value);
  });
  return out;
}
