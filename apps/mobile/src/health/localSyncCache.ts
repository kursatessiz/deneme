import * as SecureStore from 'expo-secure-store';
import { healthSyncIdempotencyKey, type HealthPlatform } from '@platform/shared';

const STORAGE_KEY = 'health-sync-cache-v1';
const MAX_ENTRIES = 500; // bookings are short-lived; this comfortably covers months of history

/**
 * On-device half of the write idempotency guarantee (the server's
 * HealthSyncRecord unique constraint is the other half): before writing a
 * booking's workout to the health store, the app checks this set so it
 * never even attempts the native write twice, e.g. across quick app
 * relaunches before the server round-trip completes.
 */
async function loadKeys(): Promise<string[]> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

async function saveKeys(keys: string[]): Promise<void> {
  try {
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(keys.slice(-MAX_ENTRIES)));
  } catch {
    // Best-effort: a failed local write only means one extra idempotent
    // server call next time, never a duplicate health-store write, since
    // the server's own unique constraint also rejects it.
  }
}

export async function hasSyncedLocally(memberId: string, bookingId: string, platform: HealthPlatform): Promise<boolean> {
  const key = healthSyncIdempotencyKey(memberId, bookingId, platform);
  const keys = await loadKeys();
  return keys.includes(key);
}

export async function markSyncedLocally(memberId: string, bookingId: string, platform: HealthPlatform): Promise<void> {
  const key = healthSyncIdempotencyKey(memberId, bookingId, platform);
  const keys = await loadKeys();
  if (keys.includes(key)) return;
  await saveKeys([...keys, key]);
}

export async function clearLocalSyncCache(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(STORAGE_KEY);
  } catch {
    // ignore
  }
}
