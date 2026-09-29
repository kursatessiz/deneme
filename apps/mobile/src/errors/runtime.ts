import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { AppState } from 'react-native';

import { mobileRelease } from '@platform/shared';
import type { BreadcrumbType } from '@platform/shared';

import { ApiError, apiRequest } from '../lib/api';
import { appBreadcrumbs } from './breadcrumbs';
import { createMobileReporter } from './reporterCore';
import type { ReportOptions, ReportResult } from './reporterCore';
import type { SendResult } from './queue';

/**
 * Wires the mobile error reporter to the app (H2, docs/HATA_RAPORLAMA.md):
 * AsyncStorage for the offline queue, the API client for POST
 * /telemetry/errors (authenticated when logged in, anonymous otherwise --
 * the endpoint accepts both), the global JS error handler, unhandled
 * promise rejections and AppState (flush on start and on foreground).
 */

interface ErrorUtilsLike {
  getGlobalHandler(): (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void;
}
interface HermesLike {
  enablePromiseRejectionTracker?: (options: { allRejections: boolean; onUnhandled: (id: number, error: unknown) => void }) => void;
}

/** The app's release: version plus the EAS Update id when the running bundle came from an update. */
export function currentRelease(): string {
  const updateId = Constants.manifest2?.id;
  return mobileRelease(Constants.expoConfig?.version, typeof updateId === 'string' ? updateId : null);
}

/** The EAS build profile (eas.json sets APP_VARIANT, exposed by app.config.ts as extra.appVariant). */
export function currentEnvironment(): string {
  const variant = (Constants.expoConfig?.extra as { appVariant?: unknown } | undefined)?.appVariant;
  if (typeof variant === 'string' && variant) return variant;
  return typeof __DEV__ !== 'undefined' && __DEV__ ? 'development' : 'production';
}

let activeStudioId: string | null = null;
let activeRoute: string | null = null;

/** Studio sent with error batches (the API attaches it only after a membership check). */
export function setErrorStudio(studioId: string | null): void {
  activeStudioId = studioId;
}

export function setErrorRoute(route: string | null): void {
  activeRoute = route;
}

async function send(batch: Parameters<Parameters<typeof createMobileReporter>[0]['send']>[0]): Promise<SendResult> {
  try {
    await apiRequest('/telemetry/errors', { method: 'POST', body: { events: batch }, studioId: activeStudioId ?? undefined });
    return 'sent';
  } catch (err) {
    // 400 and 413 mean the batch itself is invalid; everything else (offline, 429, 5xx) is worth another try.
    if (err instanceof ApiError && (err.status === 400 || err.status === 413 || err.status === 422)) return 'drop';
    return 'retry';
  }
}

const reporter = createMobileReporter({
  storage: AsyncStorage,
  send,
  breadcrumbs: appBreadcrumbs,
  getContext: () => ({ release: currentRelease(), environment: currentEnvironment(), route: activeRoute }),
});

/** Records an error; returns the short code to show the user (null when deduplicated or capped). Never throws. */
export function reportError(error: unknown, options: ReportOptions = {}): string | null {
  return reporter.report(error, options).code;
}

export function addBreadcrumb(type: BreadcrumbType, message: string, data?: Record<string, string>): void {
  appBreadcrumbs.add(type, message, data);
}

export function flushErrorQueue(): Promise<void> {
  return reporter.flush();
}

let installed = false;

/**
 * Installs the global handlers once: ErrorUtils (uncaught JS errors; a fatal
 * one is persisted before the platform's own handler ends the app),
 * unhandled promise rejections (Hermes) and the AppState flush.
 */
export function installErrorReporting(): void {
  if (installed) return;
  installed = true;
  try {
    const errorUtils = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
    if (errorUtils) {
      const previous = errorUtils.getGlobalHandler();
      errorUtils.setGlobalHandler((error, isFatal) => {
        let persisted: Promise<void> = Promise.resolve();
        try {
          persisted = reporter.report(error, { severity: isFatal ? 'fatal' : 'error' }).persisted;
        } catch {
          // Fall through to the default handler.
        }
        if (isFatal) {
          // The default handler ends the app: give the queue write a moment to reach the disk first.
          void Promise.race([persisted, new Promise<void>((resolve) => setTimeout(resolve, 500))]).then(() => previous(error, isFatal));
        } else {
          previous(error, isFatal);
        }
      });
    }

    // In development React Native's own tracker feeds LogBox; in release builds ours reports.
    const hermes = (globalThis as { HermesInternal?: HermesLike }).HermesInternal;
    if (!(typeof __DEV__ !== 'undefined' && __DEV__) && hermes?.enablePromiseRejectionTracker) {
      hermes.enablePromiseRejectionTracker({
        allRejections: true,
        onUnhandled: (_id, error) => {
          reporter.report(error, { severity: 'error' });
        },
      });
    }

    AppState.addEventListener('change', (state) => {
      if (state === 'active') void reporter.flush();
    });
    void reporter.flush();
  } catch {
    // Reporting must never stop the app from starting.
  }
}

export type { ReportResult };
