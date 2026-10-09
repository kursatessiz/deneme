'use client';

import { clientT } from '@/lib/i18n/client-translator';
import { normalizeRoute } from '@platform/shared';
import { CSRF_HEADER_NAME, CSRF_HEADER_VALUE } from '@/lib/bff/csrf';
import { addBreadcrumb } from '@/lib/errors/reporter';

export class BffError extends Error {
  constructor(
    message: string,
    public status: number,
    /** Stable error code from the API body (e.g. "AI_NOT_CONFIGURED"), when it sends one. */
    public code: string | null = null,
    /** Interpolation params of the error (e.g. the conflicting session date), when the API sends them. */
    public params: Record<string, string | number> | null = null,
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
  options: { method?: string; body?: unknown; studioId?: string | null; headers?: Record<string, string>; keepalive?: boolean } = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { ...options.headers };
  if (method !== 'GET' && method !== 'HEAD') {
    headers[CSRF_HEADER_NAME] = CSRF_HEADER_VALUE;
  }
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.studioId) headers['x-studio-id'] = options.studioId;

  const res = await fetch(`/api/bff/${path.replace(/^\/+/, '')}`, {
    method,
    headers,
    credentials: 'same-origin',
    // keepalive lets a last save finish while the page unloads (the overview board flushes its pending layout).
    keepalive: options.keepalive,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  // Breadcrumb for error reports: method, route with ids removed, status. Never the body or query.
  addBreadcrumb('request', `${method} ${normalizeRoute(`/${path.replace(/^\/+/, '')}`)}`, { status: String(res.status) });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const code = data && typeof data.code === 'string' ? (data.code as string) : null;
    const params = data && data.params && typeof data.params === 'object' ? (data.params as Record<string, string | number>) : null;
    throw new BffError((data && (data.message as string)) || clientT('common.error.requestFailed', { status: res.status }), res.status, code, params);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
