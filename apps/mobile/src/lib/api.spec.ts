jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { apiUrl: 'http://api.test' } } } }));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'tr-TR' }] }));
const tokenState: { refresh: string | null } = { refresh: null };
const clearTokensMock = jest.fn(async () => undefined);
const setTokensMock = jest.fn(async () => undefined);
jest.mock('./tokenStore', () => ({
  getAccessToken: async () => 'access-1',
  getRefreshToken: async () => tokenState.refresh,
  setTokens: (...args: unknown[]) => setTokensMock(...(args as [])),
  clearTokens: () => clearTokensMock(),
}));
jest.mock('../i18n/storage', () => ({ getStoredLocaleChoice: async () => null }));

import { setActiveLocale } from '../i18n/activeLocale';
import { ApiError, apiRequest } from './api';

function respondWith(status: number, body: unknown): jest.Mock {
  const fetchMock = jest.fn(async () => ({ status, ok: status < 400, text: async () => JSON.stringify(body) }));
  (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
  return fetchMock;
}

describe('apiRequest', () => {
  afterEach(() => setActiveLocale(null));

  it('sends the active locale as Accept-Language', async () => {
    setActiveLocale('en');
    const fetchMock = respondWith(200, { ok: true });
    await apiRequest('/ping', { auth: false });
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers['Accept-Language']).toBe('en');
  });

  it('falls back to the device language before the app has resolved a locale', async () => {
    const fetchMock = respondWith(200, { ok: true });
    await apiRequest('/ping', { auth: false });
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers['Accept-Language']).toBe('tr');
  });

  it('translates an apiErrors code with its params in the active locale', async () => {
    setActiveLocale('en');
    respondWith(400, { code: 'apiErrors.growth.invalidOperator', message: 'Geçersiz işlem: ~', params: { op: '~' } });
    const error = await apiRequest('/x', { auth: false }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe('Invalid operator: ~');
    expect((error as ApiError).code).toBe('apiErrors.growth.invalidOperator');
  });

  it('keeps the Turkish text for a Turkish app', async () => {
    setActiveLocale('tr');
    respondWith(404, { code: 'apiErrors.common.memberNotFound', message: 'Üye bulunamadı' });
    const error = await apiRequest('/x', { auth: false }).catch((e: unknown) => e);
    expect((error as ApiError).message).toBe('Üye bulunamadı');
  });

  it('shows the server message of an error without a translatable code', async () => {
    setActiveLocale('en');
    respondWith(400, { message: 'plain text' });
    const error = await apiRequest('/x', { auth: false }).catch((e: unknown) => e);
    expect((error as ApiError).message).toBe('plain text');
  });
});

/** First call answers 401 (expired access token); the refresh call answers `refreshStatus` (or throws when null). */
function expiredThenRefresh(refreshStatus: number | null, refreshBody: unknown = {}): jest.Mock {
  const fetchMock = jest.fn(async (url: string) => {
    if (url.endsWith('/auth/refresh')) {
      if (refreshStatus === null) throw new TypeError('Network request failed');
      return { status: refreshStatus, ok: refreshStatus < 400, json: async () => refreshBody, text: async () => JSON.stringify(refreshBody) };
    }
    return { status: 401, ok: false, text: async () => JSON.stringify({ message: 'expired' }) };
  });
  (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
  return fetchMock;
}

describe('apiRequest token refresh', () => {
  beforeEach(() => {
    tokenState.refresh = 'refresh-1';
    clearTokensMock.mockClear();
    setTokensMock.mockClear();
  });

  it.each([401, 403])('signs out when the refresh endpoint answers %i', async (status) => {
    expiredThenRefresh(status);
    const error = await apiRequest('/me').catch((e: unknown) => e);
    expect((error as ApiError).status).toBe(401);
    expect(clearTokensMock).toHaveBeenCalledTimes(1);
  });

  it.each([429, 500, 503])('keeps the tokens when the refresh endpoint answers %i', async (status) => {
    expiredThenRefresh(status);
    const error = await apiRequest('/me').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(status);
    expect(clearTokensMock).not.toHaveBeenCalled();
  });

  it('keeps the tokens when the refresh call cannot reach the API', async () => {
    expiredThenRefresh(null);
    const error = await apiRequest('/me').catch((e: unknown) => e);
    expect((error as ApiError).status).toBe(0);
    expect(clearTokensMock).not.toHaveBeenCalled();
  });

  it('stores the renewed pair and retries once on success', async () => {
    const fetchMock = expiredThenRefresh(200, { accessToken: 'a2', refreshToken: 'r2' });
    await apiRequest('/me').catch(() => undefined);
    expect(setTokensMock).toHaveBeenCalledWith('a2', 'r2');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(clearTokensMock).not.toHaveBeenCalled();
  });

  it('keeps the code and params of an API error', async () => {
    respondWith(400, { code: 'apiErrors.schedules.minRepeatIntervalNotElapsed', message: 'x', params: { count: 2, date: '2030-01-01T10:00:00.000Z' } });
    const error = (await apiRequest('/schedules/book', { method: 'POST' }).catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe('apiErrors.schedules.minRepeatIntervalNotElapsed');
    expect(error.params).toEqual({ count: 2, date: '2030-01-01T10:00:00.000Z' });
  });
});
