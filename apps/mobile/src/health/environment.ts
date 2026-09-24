import Constants from 'expo-constants';

/**
 * True inside the Expo Go client, where no custom native module is linked
 * (HealthKit and Health Connect both need a development build). Every
 * platform module in src/health checks this before touching native code, so
 * the rest of the app keeps working (as a documented no-op) in Expo Go.
 */
export function isExpoGo(): boolean {
  return Constants.appOwnership === 'expo';
}
