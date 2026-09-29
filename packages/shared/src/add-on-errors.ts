import type { MessageKey } from './i18n/messages';

/**
 * Stable error codes of the add-on marketplace (G5c-2, docs/UYGULAMA_PAZARI.md).
 * Kept in a file without runtime imports so billing.ts can spread the
 * translation table into TRANSLATED_API_ERROR_CODES without an import cycle.
 * Clients translate `addOns.error.<code>`.
 */
export const ADD_ON_ERROR_CODES = {
  notFound: 'ADD_ON_NOT_FOUND',
  trialUsed: 'ADD_ON_TRIAL_USED',
  trialUnavailable: 'ADD_ON_TRIAL_UNAVAILABLE',
  alreadyActive: 'ADD_ON_ALREADY_ACTIVE',
  priceUnavailable: 'ADD_ON_PRICE_UNAVAILABLE',
  paymentPending: 'ADD_ON_PAYMENT_PENDING',
  notCancellable: 'ADD_ON_NOT_CANCELLABLE',
  publishNeedsPrice: 'ADD_ON_PUBLISH_NEEDS_PRICE',
  keyExists: 'ADD_ON_KEY_EXISTS',
} as const;

export const ADD_ON_TRANSLATED_ERRORS: Readonly<Record<string, MessageKey>> = {
  [ADD_ON_ERROR_CODES.notFound]: 'addOns.error.ADD_ON_NOT_FOUND',
  [ADD_ON_ERROR_CODES.trialUsed]: 'addOns.error.ADD_ON_TRIAL_USED',
  [ADD_ON_ERROR_CODES.trialUnavailable]: 'addOns.error.ADD_ON_TRIAL_UNAVAILABLE',
  [ADD_ON_ERROR_CODES.alreadyActive]: 'addOns.error.ADD_ON_ALREADY_ACTIVE',
  [ADD_ON_ERROR_CODES.priceUnavailable]: 'addOns.error.ADD_ON_PRICE_UNAVAILABLE',
  [ADD_ON_ERROR_CODES.paymentPending]: 'addOns.error.ADD_ON_PAYMENT_PENDING',
  [ADD_ON_ERROR_CODES.notCancellable]: 'addOns.error.ADD_ON_NOT_CANCELLABLE',
  [ADD_ON_ERROR_CODES.publishNeedsPrice]: 'addOns.error.ADD_ON_PUBLISH_NEEDS_PRICE',
  [ADD_ON_ERROR_CODES.keyExists]: 'addOns.error.ADD_ON_KEY_EXISTS',
};
