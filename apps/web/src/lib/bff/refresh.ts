export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * Result of exchanging a refresh token. Only `rejected` (the API answered
 * 401/403) means the session is gone and its cookies may be cleared; a rate
 * limit, a 5xx or an unreachable API is `unavailable` and leaves the session
 * as it is, so a transient outage never signs the user out.
 */
export type RefreshOutcome = { kind: 'renewed'; tokens: TokenPair } | { kind: 'rejected' } | { kind: 'unavailable'; status: number };

/** Status the browser gets for an `unavailable` refresh: a rate limit stays 429, anything else is 503. */
export function unavailableStatus(status: number): number {
  return status === 429 ? 429 : 503;
}

export async function exchangeRefreshToken(
  apiBaseUrl: string,
  refreshToken: string,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<RefreshOutcome> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(`${apiBaseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
      ...(options.timeoutMs ? { signal: AbortSignal.timeout(options.timeoutMs) } : {}),
    });
  } catch {
    return { kind: 'unavailable', status: 503 };
  }
  if (res.status === 401 || res.status === 403) return { kind: 'rejected' };
  if (!res.ok) return { kind: 'unavailable', status: unavailableStatus(res.status) };
  const data = (await res.json().catch(() => null)) as { accessToken?: unknown; refreshToken?: unknown } | null;
  if (typeof data?.accessToken !== 'string' || typeof data.refreshToken !== 'string') return { kind: 'unavailable', status: 503 };
  return { kind: 'renewed', tokens: { accessToken: data.accessToken, refreshToken: data.refreshToken } };
}
