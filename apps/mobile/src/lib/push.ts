import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { apiRequest } from './api';

/** Show alerts while the app is foregrounded. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/** Token most recently registered with the backend, kept for sign-out cleanup. */
let registeredToken: string | null = null;

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'default',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

export async function getNotificationPermissionStatus(): Promise<Notifications.PermissionStatus> {
  const { status } = await Notifications.getPermissionsAsync();
  return status;
}

/**
 * Requests OS permission (on a physical device) and returns the Expo push
 * token, or null when permission was denied, the device is a simulator, or
 * no EAS project id is configured. Never throws.
 */
async function obtainExpoPushToken(): Promise<string | null> {
  if (!Device.isDevice) {
    console.warn('[push] Physical device required for push notifications; skipping.');
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    console.warn('[push] Notification permission was not granted; skipping registration.');
    return null;
  }

  await ensureAndroidChannel();

  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId) {
    console.warn('[push] Missing extra.eas.projectId; skipping push token registration.');
    return null;
  }

  try {
    const result = await Notifications.getExpoPushTokenAsync({ projectId });
    return result.data;
  } catch (error) {
    console.warn('[push] Failed to obtain Expo push token', error);
    return null;
  }
}

/** Requests permission, gets a token, and registers the device with the API. */
export async function registerPushDevice(): Promise<void> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;

  const token = await obtainExpoPushToken();
  if (!token) return;

  try {
    await apiRequest<void>('/me/push-devices', {
      method: 'POST',
      body: { token, platform: Platform.OS, deviceName: Device.deviceName ?? undefined },
    });
    registeredToken = token;
  } catch (error) {
    console.warn('[push] Failed to register push device with API', error);
  }
}

/** Removes the last registered device token from the API, e.g. on sign-out. */
export async function unregisterPushDevice(): Promise<void> {
  const token = registeredToken;
  if (!token) return;
  try {
    await apiRequest<void>(`/me/push-devices/${encodeURIComponent(token)}`, { method: 'DELETE' });
  } catch (error) {
    console.warn('[push] Failed to unregister push device', error);
  } finally {
    registeredToken = null;
  }
}
