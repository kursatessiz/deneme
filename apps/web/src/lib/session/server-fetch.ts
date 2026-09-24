import { apiInternalBaseUrl } from '@/lib/server-env';

/**
 * Minimal server-side GET against the API, used by server components that
 * need a small piece of data (branches for the switcher) alongside the
 * session itself. Never throws: callers get `null` and render around it,
 * since a failure here should not take down the dashboard shell.
 */
export async function serverGet<T>(path: string, accessToken: string, studioId: string): Promise<T | null> {
  try {
    const res = await fetch(`${apiInternalBaseUrl()}/${path.replace(/^\/+/, '')}`, {
      headers: { authorization: `Bearer ${accessToken}`, 'x-studio-id': studioId },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
