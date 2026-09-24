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
  if (!session) throw new ApiError(401, 'Bu cihaz eşleştirilmemiş');

  const { method = 'GET', body } = options;
  let response: Response;
  try {
    response = await fetch(`${resolveApiUrl()}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Sunucuya bağlanılamadı. Bağlantınızı kontrol edip tekrar deneyin.');
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
    const errorBody = payload as { message?: string } | null;
    throw new ApiError(response.status, errorBody?.message ?? 'Beklenmeyen bir hata oluştu.');
  }

  return payload as T;
}
