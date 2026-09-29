'use client';

import { useMemo } from 'react';
import { BASE_MESSAGES, BUNDLED_MESSAGES, createTranslator } from '@platform/shared';
import { ErrorScreen } from '@/components/errors/ErrorScreen';
import './globals.css';

/** The bundled language closest to the browser's, Turkish otherwise (the root layout and its provider are gone here). */
function browserLocale(): string {
  if (typeof navigator === 'undefined') return 'tr';
  for (const candidate of navigator.languages ?? [navigator.language]) {
    const base = (candidate ?? '').split('-')[0].toLowerCase();
    if (BUNDLED_MESSAGES[base]) return base;
  }
  return 'tr';
}

/**
 * Last-resort boundary when the root layout itself fails: renders its own
 * <html> and <body>, reports the error and shows the error code.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const locale = browserLocale();
  const t = useMemo(() => createTranslator({ locale, messages: BUNDLED_MESSAGES[locale] ?? BASE_MESSAGES, fallback: BASE_MESSAGES }), [locale]);
  return (
    <html lang={locale}>
      <body className="antialiased">
        <ErrorScreen error={error} reset={reset} t={t} />
      </body>
    </html>
  );
}
