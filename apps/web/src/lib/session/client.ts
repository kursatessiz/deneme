'use client';

import { normalizeRoute } from '@platform/shared';
import { CSRF_HEADER_NAME, CSRF_HEADER_VALUE } from '@/lib/bff/csrf';
import { addBreadcrumb } from '@/lib/errors/reporter';

export class BffError extends Error {
  constructor(
    message: string,
    public status: number,
    /** Stable error code from the API body (e.g. "AI_NOT_CONFIGURED"), when it sends one. */
    public code: string | null = null,
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
  // Breadcrumb for error reports: method, route with ids removed, status. Never the body or query.
  addBreadcrumb('request', `${method} ${normalizeRoute(`/${path.replace(/^\/+/, '')}`)}`, { status: String(res.status) });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const code = data && typeof data.code === 'string' ? (data.code as string) : null;
    throw new BffError((data && (data.message as string)) || `İstek başarısız oldu (${res.status})`, res.status, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
