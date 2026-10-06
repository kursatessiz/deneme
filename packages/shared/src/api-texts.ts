import type { trApiTexts } from './i18n/messages/tr/apiTexts';

type PluralBase<K> = K extends `${infer B}.one` | `${infer B}.other` ? B : K;

/** Every `apiTexts.*` message key (plural keys without their `.one`/`.other` suffix). */
export type ApiTextKey = PluralBase<keyof typeof trApiTexts>;
