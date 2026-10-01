'use client';

import { Button } from '@/components/ui';
import { OPEN_CONSENT_EVENT } from './TrackingProvider';

/** Reopens the consent banner so a visitor can change or withdraw consent at any time. */
export function CookiePreferencesButton({ label }: { label: string }) {
  return (
    <Button variant="link" tone="surface" size="sm" onClick={() => window.dispatchEvent(new Event(OPEN_CONSENT_EVENT))}>
      {label}
    </Button>
  );
}
