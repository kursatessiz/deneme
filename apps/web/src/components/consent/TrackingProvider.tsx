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
import { ConsentBanner } from './ConsentBanner';

type NavigatorWithGpc = Navigator & { globalPrivacyControl?: boolean };

/**
 * Consent + visitor tracking for one public page tree. `studioSlug` is the
 * tenant the visit belongs to (`platform` on the product site). Nothing is
 * stored and nothing is sent until the region's rules allow analytics.
 */
export function TrackingProvider({ studioSlug, region }: { studioSlug: string; region: ConsentRegion }) {
  const locale = useLocale();
  const pathname = usePathname();
  const [state, setState] = useState<ConsentState | null>(null);
  const [gpc, setGpc] = useState(false);

  useEffect(() => {
    const signal = (navigator as NavigatorWithGpc).globalPrivacyControl === true;
    const initial = initialConsent(region.mode, parseConsent(readStoredConsent()), signal);
    consentModeDefault(region.mode, initial);
    if (initial.decided) consentModeUpdate(initial);
    setGpc(signal);
    setState(initial);
  }, [region.mode]);

  useEffect(() => {
    if (!state?.analytics) return;
    void trackPageView({ studioSlug, consent: state, locale });
  }, [state, studioSlug, locale, pathname]);

  const onDecide = useCallback(
    (choice: ConsentChoice) => {
      const next = decide(choice, gpc);
      storeConsent(next);
      consentModeUpdate(next);
      if (!next.analytics) clearTrackingCookies();
      setState(next);
    },
    [gpc],
  );

  if (!state || state.decided) return null;
  return <ConsentBanner mode={region.mode} gpc={gpc} onDecide={onDecide} />;
}
