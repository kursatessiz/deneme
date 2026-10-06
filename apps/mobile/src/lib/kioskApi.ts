import { translateApiErrorBody } from '@platform/shared';
import { getActiveLocale } from '../i18n/activeLocale';
import { resolveOfflineLocale, resolveOfflineTranslate } from '../i18n/offlineTranslate';
import { ApiError } from './api';
import { resolveApiUrl } from './api';
import { getKioskSession } from './kioskStore';

interface KioskRequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
}

/**
 * Fetch wrapper for /kiosk/* endpoints. Uses the paired device's kiosk
 * token, never the member/staff access token, and never retries through
 * the access-token refresh flow (a kiosk token is not refreshed; it is
 * re-paired instead).
 */
export async function kioskRequest<T>(path: string, options: KioskRequestOptions = {}): Promise<T> {
  const session = await getKioskSession();
  if (!session) throw new ApiError(401, (await resolveOfflineTranslate())('mApiErrors.kioskNotPaired'));

  const { method = 'GET', body } = options;
  let response: Response;
  try {
    response = await fetch(`${resolveApiUrl()}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': getActiveLocale() ?? (await resolveOfflineLocale()),
        Authorization: `Bearer ${session.token}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, (await resolveOfflineTranslate())('mApiErrors.networkUnreachable'));
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const errorBody = payload as { message?: string; code?: unknown } | null;
    const t = await resolveOfflineTranslate();
    const translated = errorBody ? translateApiErrorBody(errorBody as Record<string, unknown>, t) : null;
    const raw = translated?.message;
    const message = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.join(', ') : t('mApiErrors.unexpectedError');
    throw new ApiError(response.status, message, undefined, typeof errorBody?.code === 'string' ? errorBody.code : undefined);
  }

  return payload as T;
}
