jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { apiUrl: 'http://api.test' } } } }));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'tr-TR' }] }));
jest.mock('./tokenStore', () => ({
  getAccessToken: async () => null,
  getRefreshToken: async () => null,
  setTokens: async () => undefined,
  clearTokens: async () => undefined,
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
