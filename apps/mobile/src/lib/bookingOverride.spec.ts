jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { apiUrl: 'http://api.test' } } } }));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'tr-TR' }] }));
jest.mock('./tokenStore', () => ({ getAccessToken: async () => null, getRefreshToken: async () => null, setTokens: async () => undefined, clearTokens: async () => undefined }));
jest.mock('../i18n/storage', () => ({ getStoredLocaleChoice: async () => null }));

import { ApiError } from './api';
import { repeatIntervalConflict, REPEAT_INTERVAL_ERROR_CODE } from './bookingOverride';

describe('repeatIntervalConflict', () => {
  it('reads the count and the conflicting date of the rule error', () => {
    const error = new ApiError(400, 'm', undefined, REPEAT_INTERVAL_ERROR_CODE, { count: 3, date: '2030-01-01T10:00:00.000Z' });
    expect(repeatIntervalConflict(error)).toEqual({ count: 3, date: '2030-01-01T10:00:00.000Z' });
  });

  it('ignores other errors and errors without the date', () => {
    expect(repeatIntervalConflict(new ApiError(400, 'm', undefined, 'apiErrors.schedules.sessionFull'))).toBeNull();
    expect(repeatIntervalConflict(new ApiError(400, 'm', undefined, REPEAT_INTERVAL_ERROR_CODE, { count: 3 }))).toBeNull();
    expect(repeatIntervalConflict(new Error('x'))).toBeNull();
  });
});
