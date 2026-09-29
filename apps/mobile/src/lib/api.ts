import Constants from 'expo-constants';

import { resolveOfflineTranslate } from '../i18n/offlineTranslate';
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from './tokenStore';

const DEFAULT_API_URL = 'http://localhost:4000';

/** API base URL: EXPO_PUBLIC_API_URL overrides app.json's extra.apiUrl. */
export function resolveApiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv;
  const extra = Constants.expoConfig?.extra as { apiUrl?: string } | undefined;
  return extra?.apiUrl ?? DEFAULT_API_URL;
}

export interface ApiFieldError {
  path: string;
  message: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly fieldErrors?: ApiFieldError[];

  constructor(status: number, message: string, fieldErrors?: ApiFieldError[]) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Attach the bearer token and retry once on 401. Default true. */
  auth?: boolean;
  /** Internal: marks this call as a post-refresh retry, to avoid loops. */
  isRetry?: boolean;
  /** Tenant for studio-scoped routes that carry no :studioId in the path. */
  studioId?: string;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

let inFlightRefresh: Promise<boolean> | null = null;

async function performRefresh(): Promise<boolean> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return false;
  try {
    const response = await fetch(`${resolveApiUrl()}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) return false;
    const data = (await response.json()) as TokenPair;
    await setTokens(data.accessToken, data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

/** Single-flight refresh: concurrent 401s share one refresh call. */
function refreshOnce(): Promise<boolean> {
  if (!inFlightRefresh) {
    inFlightRefresh = performRefresh().finally(() => {
      inFlightRefresh = null;
    });
  }
  return inFlightRefresh;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, isRetry = false, studioId } = options;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (studioId) headers['x-studio-id'] = studioId;
  if (auth) {
    const token = await getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${resolveApiUrl()}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    const t = await resolveOfflineTranslate();
    throw new ApiError(0, t('mApiErrors.networkUnreachable'));
  }

  if (response.status === 401 && auth && !isRetry) {
    const refreshed = await refreshOnce();
    if (refreshed) {
      return apiRequest<T>(path, { ...options, isRetry: true });
    }
    await clearTokens();
    const t = await resolveOfflineTranslate();
    throw new ApiError(401, t('mApiErrors.sessionExpired'));
  }

  if (response.status === 429) {
    const t = await resolveOfflineTranslate();
    throw new ApiError(429, t('mApiErrors.tooManyAttempts'));
  }

  if (response.status === 204) {
    return undefined as T;
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
    const errorBody = payload as { message?: string; errors?: ApiFieldError[] } | null;
    const message = errorBody?.message ?? (await resolveOfflineTranslate())('mApiErrors.unexpectedError');
    throw new ApiError(response.status, message, errorBody?.errors);
  }

  return payload as T;
}
