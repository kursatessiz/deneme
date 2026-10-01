/**
 * Fetches a tenant logo for embedding in a generated Open Graph image. The
 * URL is tenant input, so the server only follows plain public https URLs:
 * no IP literals, no single-label or internal hostnames, no redirects, a short
 * timeout and a size cap. Anything else returns null and the card is drawn
 * without a logo. Only PNG and JPEG are embedded (the formats satori reads
 * reliably).
 */

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
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || host.startsWith('[') || /^[0-9.]+$/.test(host)) return false;
  return !INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export async function fetchLogoDataUri(raw: string | null | undefined): Promise<string | null> {
  if (!raw || !isPublicHttpsUrl(raw)) return null;
  try {
    const res = await fetch(raw, { redirect: 'error', signal: AbortSignal.timeout(LOGO_TIMEOUT_MS), next: { revalidate: 3600 } });
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_TYPES.has(type)) return null;
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > MAX_LOGO_BYTES) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_LOGO_BYTES) return null;
    return `data:${type};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}
