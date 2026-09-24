'use client';

import { CSRF_HEADER_NAME, CSRF_HEADER_VALUE } from '@/lib/bff/csrf';

export class BffError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/**
 * The only way client components talk to the API: always through the BFF,
 * same-origin, cookie-authenticated. Never call the API directly from the
 * browser -- there is no token in client JS to attach.
 */
export async function bffFetch<T>(
  path: string,
  options: { method?: string; body?: unknown; studioId?: string | null } = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (method !== 'GET' && method !== 'HEAD') {
    headers[CSRF_HEADER_NAME] = CSRF_HEADER_VALUE;
  }
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.studioId) headers['x-studio-id'] = options.studioId;

  const res = await fetch(`/api/bff/${path.replace(/^\/+/, '')}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new BffError((data && (data.message as string)) || `İstek başarısız oldu (${res.status})`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
