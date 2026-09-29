import { ERROR_LIMITS, normalizeRoute, scrubPii, scrubRecord, truncate } from '@platform/shared';
import type { Breadcrumb, BreadcrumbType } from '@platform/shared';

/**
 * Ring buffer of the last steps before an error (docs/HATA_RAPORLAMA.md):
 * screen navigation, taps on primary buttons and API requests (method, route
 * without query or ids, status code; never bodies or headers). Everything is
 * scrubbed with the shared scrubber on the way in. Adding a breadcrumb never
 * throws.
 */
export class BreadcrumbBuffer {
  private readonly crumbs: Breadcrumb[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  add(type: BreadcrumbType, message: string, data?: Record<string, string>): void {
    try {
      const text = scrubPii(truncate(message, ERROR_LIMITS.breadcrumbMessageLength * 2), ERROR_LIMITS.breadcrumbMessageLength).slice(
        0,
        ERROR_LIMITS.breadcrumbMessageLength,
      );
      this.crumbs.push({
        type,
        message: text,
        at: new Date(this.now()).toISOString(),
        ...(data ? { data: scrubRecord(data, ERROR_LIMITS.breadcrumbDataValueLength) } : {}),
      });
      if (this.crumbs.length > ERROR_LIMITS.breadcrumbs) this.crumbs.splice(0, this.crumbs.length - ERROR_LIMITS.breadcrumbs);
    } catch {
      // Breadcrumbs are best effort.
    }
  }

  snapshot(): Breadcrumb[] {
    return this.crumbs.slice(-ERROR_LIMITS.breadcrumbs);
  }
}

/** The app's buffer, shared by the API client, buttons, navigation and the reporter. */
export const appBreadcrumbs = new BreadcrumbBuffer();

/** An API request breadcrumb; the telemetry endpoint itself is never recorded. Status 0 = network failure. */
export function trackRequest(buffer: BreadcrumbBuffer, method: string, path: string, status: number): void {
  try {
    if (path.startsWith('/telemetry/')) return;
    buffer.add('request', normalizeRoute(path), { method, status: String(status) });
  } catch {
    // Never break a request for a breadcrumb.
  }
}
