import * as SecureStore from 'expo-secure-store';

/**
 * Kiosk pairing state (W17), kept separate from the member/staff auth
 * tokens in tokenStore.ts: a kiosk token is device-bound, not user-bound,
 * and is never refreshed the way access tokens are.
 */
const KIOSK_TOKEN_KEY = 'platform.kiosk.token';
const KIOSK_META_KEY = 'platform.kiosk.meta';

export interface KioskSession {
  token: string;
  studioId: string;
  branchId: string;
  deviceName: string;
}

export async function getKioskSession(): Promise<KioskSession | null> {
  const token = await SecureStore.getItemAsync(KIOSK_TOKEN_KEY);
  if (!token) return null;
  const rawMeta = await SecureStore.getItemAsync(KIOSK_META_KEY);
  if (!rawMeta) return null;
  try {
    const meta = JSON.parse(rawMeta) as Omit<KioskSession, 'token'>;
    return { token, ...meta };
  } catch {
    return null;
  }
}

export async function setKioskSession(session: KioskSession): Promise<void> {
  await SecureStore.setItemAsync(KIOSK_TOKEN_KEY, session.token);
  await SecureStore.setItemAsync(
    KIOSK_META_KEY,
    JSON.stringify({ studioId: session.studioId, branchId: session.branchId, deviceName: session.deviceName }),
  );
}

export async function clearKioskSession(): Promise<void> {
  await SecureStore.deleteItemAsync(KIOSK_TOKEN_KEY);
  await SecureStore.deleteItemAsync(KIOSK_META_KEY);
}
