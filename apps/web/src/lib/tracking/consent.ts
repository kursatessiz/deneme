import type { ConsentMode } from './region';

/** The visitor's choice. Remembering it is strictly necessary, so this one cookie needs no consent. */
export const CONSENT_COOKIE = 'pw_consent';
export const CONSENT_COOKIE_MAX_AGE_DAYS = 180;

export interface ConsentChoice {
  analytics: boolean;
  advertising: boolean;
}

export interface ConsentState extends ConsentChoice {
  /** True once the visitor answered the banner (or had answered before). */
  decided: boolean;
}

export function serializeConsent(choice: ConsentChoice): string {
  return `v1.a${choice.analytics ? 1 : 0}.m${choice.advertising ? 1 : 0}`;
}

export function parseConsent(raw: string | null | undefined): ConsentChoice | null {
  if (!raw) return null;
  const match = /^v1\.a([01])\.m([01])$/.exec(raw.trim());
  if (!match) return null;
  return { analytics: match[1] === '1', advertising: match[2] === '1' };
}

/**
 * Consent in force before and after the banner:
 * - a stored choice always wins, except that Global Privacy Control keeps
 *   advertising off whatever was stored;
 * - opt_in and kvkk regions start with everything off;
 * - notice regions start with analytics on and advertising on unless GPC.
 * Advertising never runs without analytics (a touchpoint carries both).
 */
export function initialConsent(mode: ConsentMode, stored: ConsentChoice | null, gpc: boolean): ConsentState {
  if (stored) {
    return { analytics: stored.analytics, advertising: stored.analytics && stored.advertising && !gpc, decided: true };
  }
  if (mode === 'notice') return { analytics: true, advertising: !gpc, decided: false };
  return { analytics: false, advertising: false, decided: false };
}

/** Applies a banner answer; GPC still forces advertising off. */
export function decide(choice: ConsentChoice, gpc: boolean): ConsentState {
  return { analytics: choice.analytics, advertising: choice.analytics && choice.advertising && !gpc, decided: true };
}
