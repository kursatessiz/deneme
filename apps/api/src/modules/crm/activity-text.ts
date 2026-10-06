import { BASE_LOCALE } from '@platform/shared';
import type { ApiTextKey, MessageParams } from '@platform/shared';
import { serverT } from '../../common/server-i18n';
import type { ServerT } from '../../common/server-i18n';

/**
 * Timeline lines the CRM writes itself ("Stage changed: NEW -> TRIAL"). The row
 * keeps the message key and its parameters in `metadata.i18n`, so every viewer
 * reads the line in their own language; `body` holds the Turkish rendering as
 * a fallback for readers that do not know the key (exports, old clients).
 * Staff notes (`type: NOTE`) are free text and have no key.
 */
export interface ActivityText {
  key: ApiTextKey;
  params?: MessageParams;
}

export function activityText(key: ApiTextKey, params?: MessageParams): ActivityText {
  return params ? { key, params } : { key };
}

/** `body` and the `metadata.i18n` entry to store for a keyed timeline line. */
export function activityFields(text: ActivityText): { body: string; i18n: { key: string; params?: MessageParams } } {
  return { body: serverT(BASE_LOCALE)(text.key, text.params), i18n: text.params ? { key: text.key, params: text.params } : { key: text.key } };
}

function readI18n(metadata: unknown): ActivityText | null {
  if (typeof metadata !== 'object' || metadata === null) return null;
  const raw = (metadata as { i18n?: unknown }).i18n;
  if (typeof raw !== 'object' || raw === null) return null;
  const { key, params } = raw as { key?: unknown; params?: unknown };
  if (typeof key !== 'string' || !key.startsWith('apiTexts.crm.')) return null;
  const out: Record<string, string | number> = {};
  if (typeof params === 'object' && params !== null) {
    for (const [name, value] of Object.entries(params)) if (typeof value === 'string' || typeof value === 'number') out[name] = value;
  }
  return { key: key as ApiTextKey, params: out };
}

/** The line to show a viewer: the keyed text in their language, or the stored body. */
export function activityBodyFor(row: { body: string; metadata: unknown }, t: ServerT): string {
  const text = readI18n(row.metadata);
  return text ? t(text.key, text.params) : row.body;
}
