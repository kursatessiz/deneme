import { isIP } from 'net';

/** Loopback and private (RFC 1918 / unique local) addresses: the docker network the web container calls from. */
export function isInternalPeerAddress(address: string | undefined): boolean {
  if (!address) return false;
  const value = address.toLowerCase();
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(value);
  const ip = mapped ? mapped[1] : value;
  const version = isIP(ip);
  if (version === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (version === 6) {
    return ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd');
  }
  return false;
}

interface PeerRequest {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}

/**
 * A server-to-server call from the web container's server renders (it calls
 * API_INTERNAL_URL directly on the private docker network). Caddy, the only
 * public entry point, always sets X-Forwarded-For (deploy/caddy/Caddyfile
 * overwrites it with the client address), so an external request can never
 * look like this: it either carries the header or arrives from a public
 * peer. Per-IP public limiters skip these calls so every visitor's page view
 * does not count against one shared bucket of the web container's address.
 */
export function isInternalServerRequest(req: PeerRequest): boolean {
  if (req.headers['x-forwarded-for'] !== undefined) return false;
  return isInternalPeerAddress(req.socket?.remoteAddress);
}
