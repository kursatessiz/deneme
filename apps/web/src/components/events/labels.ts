import { EVENT_ERROR_CODES } from '@platform/shared';
import type { Translate } from '@platform/shared';
import { BffError } from '@/lib/session/client';

/** An events API error in the viewer's language: the stable `code` first, then a generic message. */
export function eventErrorMessage(err: unknown, t: Translate): string {
  if (err instanceof BffError && err.code && (EVENT_ERROR_CODES as readonly string[]).includes(err.code)) return t(`events.error.${err.code}`);
  return t('events.error.generic');
}

/** `<input type="datetime-local">` value for an ISO instant, in the browser's time zone. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO instant for a `datetime-local` value; null when empty or invalid. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
