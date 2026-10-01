'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useLocale } from '@/components/i18n/I18nProvider';
import { decide, initialConsent, parseConsent } from '@/lib/tracking/consent';
import type { ConsentChoice, ConsentState } from '@/lib/tracking/consent';
import type { ConsentRegion } from '@/lib/tracking/region';
import {
  clearTrackingCookies,
  consentModeDefault,
  consentModeUpdate,
  readStoredConsent,
  storeConsent,
  trackPageView,
} from '@/lib/tracking/client';
import { loadActivePixels, revokeAdvertisingPixels } from '@/lib/tracking/pixels';
import { ConsentBanner } from './ConsentBanner';

/** Window event that reopens the consent banner, e.g. from a footer link. */
export const OPEN_CONSENT_EVENT = 'pw-open-consent';

type NavigatorWithGpc = Navigator & { globalPrivacyControl?: boolean };

/**
 * Consent + visitor tracking for one public page tree. `studioSlug` is the
 * tenant the visit belongs to (`platform` on the product site). Nothing is
 * stored and nothing is sent until the region's rules allow analytics.
 */
export function TrackingProvider({ studioSlug, region: serverRegion }: { studioSlug: string; region: ConsentRegion | null }) {
  // Cached pages arrive without a region; it is fetched once from the edge-aware route handler. Until it is
  // known nothing is stored, sent or shown (the strictest behaviour).
  const [fetchedRegion, setFetchedRegion] = useState<ConsentRegion | null>(null);
  const region = serverRegion ?? fetchedRegion;
  useEffect(() => {
    if (serverRegion) return;
    let cancelled = false;
    fetch('/api/consent-region', { credentials: 'omit' })
      .then((res) => (res.ok ? (res.json() as Promise<ConsentRegion>) : null))
      .then((body) => {
        if (!cancelled && body) setFetchedRegion(body);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [serverRegion]);

  const locale = useLocale();
  const pathname = usePathname();
  const [state, setState] = useState<ConsentState | null>(null);
  const [gpc, setGpc] = useState(false);

  const regionMode = region?.mode ?? null;
  useEffect(() => {
    if (!regionMode) return;
    const signal = (navigator as NavigatorWithGpc).globalPrivacyControl === true;
    const initial = initialConsent(regionMode, parseConsent(readStoredConsent()), signal);
    consentModeDefault(regionMode, initial);
    if (initial.decided) consentModeUpdate(initial);
    setGpc(signal);
    setState(initial);
  }, [regionMode]);

  useEffect(() => {
    if (!state?.analytics) return;
    void trackPageView({ studioSlug, consent: state, locale });
  }, [state, studioSlug, locale, pathname]);

  useEffect(() => {
    // Advertising consent implies analytics consent (decide() enforces
    // this), so checking advertising alone is enough here.
    if (!state?.advertising) return;
    void loadActivePixels(studioSlug);
  }, [state?.advertising, studioSlug]);

  const onDecide = useCallback(
    (choice: ConsentChoice) => {
      const next = decide(choice, gpc);
      storeConsent(next);
      consentModeUpdate(next);
      if (!next.advertising) revokeAdvertisingPixels();
      if (!next.analytics) clearTrackingCookies();
      setState(next);
    },
    [gpc],
  );

  // Withdrawing consent must be as easy as giving it: any "cookie
  // preferences" control on a public page dispatches this event to reopen
  // the banner (see OPEN_CONSENT_EVENT).
  useEffect(() => {
    const reopen = () => setState((current) => (current ? { ...current, decided: false } : current));
    window.addEventListener(OPEN_CONSENT_EVENT, reopen);
    return () => window.removeEventListener(OPEN_CONSENT_EVENT, reopen);
  }, []);

  if (!state || !regionMode || state.decided) return null;
  return <ConsentBanner mode={regionMode} gpc={gpc} onDecide={onDecide} />;
}
