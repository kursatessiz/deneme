/**
 * Fetches a tenant logo for embedding a generated Open Graph image. The
 * URL is tenant input, so the server only follows plain public https URLs on
 * port 443: no IP literals, no single-label or internal hostnames, no
 * redirects, a short timeout and a size cap. The hostname is resolved first
 * and refused when any address is private or reserved; the connection is then
 * pinned to a validated address so DNS cannot change between check and
 * connect. Anything else returns null and the card is drawn without a logo. Only PNG and JPEG are embedded (the formats satori reads
 * reliably).
 */

import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isPrivateOrReservedIp } from './ip-guard';

const MAX_LOGO_BYTES = 512 * 1024;
const LOGO_TIMEOUT_MS = 1500;
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg']);
const INTERNAL_SUFFIXES = ['.local', '.localhost', '.internal', '.lan', '.home', '.corp', '.intranet'];

export function isPublicHttpsUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  if (url.port !== '' && url.port !== '443') return false;
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || host.startsWith('[') || /^[0-9.]+$/.test(host)) return false;
  return !INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

interface LogoResponse {
  contentType: string;
  bytes: Buffer;
}

/** GET over https with the socket pinned to `address`; no redirects, capped body. */
function fetchPinned(url: URL, address: string, family: 4 | 6): Promise<LogoResponse | null> {
  return new Promise((resolve) => {
    const req = httpsRequest(
      url,
      {
        method: 'GET',
        timeout: LOGO_TIMEOUT_MS,
        // The validated address replaces any further DNS resolution of the hostname.
        lookup: (_host, options, callback) => {
          if (options && typeof options === 'object' && options.all) {
            (callback as unknown as (err: null, addresses: { address: string; family: number }[]) => void)(null, [{ address, family }]);
          } else {
            callback(null, address, family);
          }
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const contentType = String(res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
        const declaredLength = Number(res.headers['content-length'] ?? '0');
        if (status !== 200 || !ALLOWED_TYPES.has(contentType) || declaredLength > MAX_LOGO_BYTES) {
          res.destroy();
          resolve(null);
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_LOGO_BYTES) {
            res.destroy();
            resolve(null);
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ contentType, bytes: Buffer.concat(chunks) }));
        res.on('error', () => resolve(null));
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
    req.end();
  });
}

export async function fetchLogoDataUri(raw: string | null | undefined): Promise<string | null> {
  if (!raw || !isPublicHttpsUrl(raw)) return null;
  try {
    const url = new URL(raw);
    const addresses = await lookup(url.hostname, { all: true });
    // Refuse when any resolved address is internal, then connect to a validated one.
    if (addresses.length === 0 || addresses.some((a) => isPrivateOrReservedIp(a.address))) return null;
    const target = addresses[0];
    const res = await fetchPinned(url, target.address, target.family === 6 ? 6 : 4);
    if (!res || res.bytes.length === 0 || res.bytes.length > MAX_LOGO_BYTES) return null;
    return `data:${res.contentType};base64,${res.bytes.toString('base64')}`;
  } catch {
    return null;
  }
}
