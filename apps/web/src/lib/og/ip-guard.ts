import { isIP } from 'node:net';

/**
 * Minimal copy of apps/api/src/modules/webhooks/ssrf-guard.ts: true when an IP
 * is private, loopback, link-local, multicast or otherwise reserved. It is
 * copied rather than shared because packages/shared is also bundled for the
 * mobile app and must not import node:net. Keep both lists in step.
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);
  return true; // not a parseable IP at all: never trust it
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;

  if (a === 127 || a === 10 || a === 0) return true; // loopback, private, "this network"
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0 && (parts[2] === 0 || parts[2] === 2)) return true; // IETF assignments, TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && parts[2] === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && parts[2] === 113) return true; // TEST-NET-3
  return a >= 224; // multicast, reserved, broadcast
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;

  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(normalized);
  if (mapped) return isPrivateIPv4(mapped[1]);
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normalized);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return isPrivateIPv4(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
  }

  if (/^fe[89ab][0-9a-f]:/.test(normalized)) return true; // link-local
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // unique local
  if (normalized.startsWith('ff')) return true; // multicast
  if (normalized.startsWith('64:ff9b::')) return true; // NAT64
  return normalized.startsWith('100::'); // discard-only
}
