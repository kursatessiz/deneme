'use client';

import { OPEN_CONSENT_EVENT } from './TrackingProvider';

/** Reopens the consent banner so a visitor can change or withdraw consent at any time. */
export function CookiePreferencesButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_CONSENT_EVENT))}
      style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', font: 'inherit', textDecoration: 'underline', cursor: 'pointer' }}
    >
      {label}
    </button>
  );
}
