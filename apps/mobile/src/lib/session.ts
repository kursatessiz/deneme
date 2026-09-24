import { createElement, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { MembershipStatus } from '@platform/shared';
import type { MembershipDTO, SessionUserDTO } from '@platform/shared';

import { apiRequest } from './api';
import { clearTokens, getAccessToken, setTokens } from './tokenStore';
import { registerPushDevice, unregisterPushDevice } from './push';
import { clearWidgetsForSignedOutState, refreshWidgets } from '../widgets';

interface OtpVerifyResponse {
  accessToken: string;
  refreshToken: string;
  user: SessionUserDTO;
  hasPin: boolean;
}

interface TokenLoginResponse {
  accessToken: string;
  refreshToken: string;
  user: SessionUserDTO;
}

interface SessionContextValue {
  /** True while restoring a persisted session on app start. */
  isLoading: boolean;
  user: SessionUserDTO | null;
  memberships: MembershipDTO[];
  activeStudioId: string | null;
  activeMembership: MembershipDTO | null;
  setActiveStudioId: (studioId: string) => void;
  requestOtp: (phone: string) => Promise<void>;
  verifyOtp: (phone: string, code: string) => Promise<{ hasPin: boolean }>;
  pinLogin: (phone: string, pin: string) => Promise<void>;
  setPin: (pin: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function pickDefaultStudioId(memberships: MembershipDTO[]): string | null {
  const firstActive = memberships.find((m) => m.status === MembershipStatus.ACTIVE);
  return firstActive?.studioId ?? memberships[0]?.studioId ?? null;
}

export function SessionProvider({ children }: { children: ReactNode }): ReactElement {
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<SessionUserDTO | null>(null);
  const [activeStudioId, setActiveStudioIdState] = useState<string | null>(null);

  const applyUser = useCallback((nextUser: SessionUserDTO) => {
    setUser(nextUser);
    setActiveStudioIdState((current) => {
      if (current && nextUser.memberships.some((m) => m.studioId === current)) return current;
      return pickDefaultStudioId(nextUser.memberships);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getAccessToken();
      if (!token) {
        if (!cancelled) setIsLoading(false);
        return;
      }
      try {
        const me = await apiRequest<SessionUserDTO>('/auth/me');
        if (!cancelled) applyUser(me);
      } catch {
        await clearTokens();
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyUser]);

  const requestOtp = useCallback(async (phone: string) => {
    await apiRequest<void>('/auth/otp/request', { method: 'POST', body: { phone }, auth: false });
  }, []);

  const verifyOtp = useCallback(
    async (phone: string, code: string) => {
      const result = await apiRequest<OtpVerifyResponse>('/auth/otp/verify', {
        method: 'POST',
        body: { phone, code },
        auth: false,
      });
      await setTokens(result.accessToken, result.refreshToken);
      applyUser(result.user);
      if (result.hasPin) {
        await registerPushDevice();
        refreshWidgets();
      }
      return { hasPin: result.hasPin };
    },
    [applyUser],
  );

  const pinLogin = useCallback(
    async (phone: string, pin: string) => {
      const result = await apiRequest<TokenLoginResponse>('/auth/pin/login', {
        method: 'POST',
        body: { phone, pin },
        auth: false,
      });
      await setTokens(result.accessToken, result.refreshToken);
      applyUser(result.user);
      await registerPushDevice();
      refreshWidgets();
    },
    [applyUser],
  );

  const setPin = useCallback(async (pin: string) => {
    await apiRequest<void>('/auth/pin', { method: 'PUT', body: { pin } });
    await registerPushDevice();
    refreshWidgets();
  }, []);

  const signOut = useCallback(async () => {
    try {
      await unregisterPushDevice();
      await apiRequest<void>('/auth/logout', { method: 'POST' });
    } catch {
      // Local session is cleared regardless of network errors during sign-out.
    } finally {
      await clearTokens();
      await clearWidgetsForSignedOutState();
      setUser(null);
      setActiveStudioIdState(null);
    }
  }, []);

  const refreshUser = useCallback(async () => {
    const me = await apiRequest<SessionUserDTO>('/auth/me');
    applyUser(me);
  }, [applyUser]);

  const setActiveStudioId = useCallback((studioId: string) => {
    setActiveStudioIdState(studioId);
  }, []);

  const memberships = user?.memberships ?? [];
  const activeMembership = memberships.find((m) => m.studioId === activeStudioId) ?? null;

  const value = useMemo<SessionContextValue>(
    () => ({
      isLoading,
      user,
      memberships,
      activeStudioId,
      activeMembership,
      setActiveStudioId,
      requestOtp,
      verifyOtp,
      pinLogin,
      setPin,
      signOut,
      refreshUser,
    }),
    [
      isLoading,
      user,
      memberships,
      activeStudioId,
      activeMembership,
      setActiveStudioId,
      requestOtp,
      verifyOtp,
      pinLogin,
      setPin,
      signOut,
      refreshUser,
    ],
  );

  return createElement(SessionContext.Provider, { value }, children);
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within a SessionProvider');
  return ctx;
}
