'use client';

import { useEffect, useState } from 'react';
import type { Translate } from '@platform/shared';
import { eventIdOf, reportError } from '@/lib/errors/reporter';
import { Button } from '@/components/ui/Button';
import { AnchorButton } from '@/components/ui/LinkButton';
import { ErrorFeedbackBox } from './ErrorFeedbackBox';

/**
 * The friendly error screen of error.tsx and global-error.tsx: reports the
 * error once and shows the short code support can search for. `t` comes
 * from the caller because global-error renders outside I18nProvider.
 */
export function ErrorScreen({ error, reset, t }: { error: Error & { digest?: string }; reset: () => void; t: Translate }) {
  const [code, setCode] = useState<string | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);

  useEffect(() => {
    // The digest links a server-rendering error to the server log line.
    setCode(reportError(error, { severity: 'fatal', extra: error.digest ? `digest ${error.digest}` : undefined }));
    setEventId(eventIdOf(error));
  }, [error]);

  return (
    <main className="min-h-[60vh] flex items-center justify-center px-4 py-16">
      <section aria-labelledby="error-screen-title" className="max-w-md w-full grid gap-4">
        <h1 id="error-screen-title" className="ui-title">
          {t('errors.boundary.title')}
        </h1>
        <p className="ui-text-muted">{t('errors.boundary.description')}</p>
        {code && (
          <div className="grid gap-1">
            <p className="ui-strong" data-testid="error-code">
              {t('errors.boundary.code', { code })}
            </p>
            <p className="ui-caption">{t('errors.boundary.codeHint')}</p>
          </div>
        )}
        {eventId && <ErrorFeedbackBox eventId={eventId} t={t} />}
        <div className="flex flex-wrap gap-3 pt-2">
          <Button onClick={reset}>{t('errors.boundary.retry')}</Button>
          {/* A full navigation, so a broken client state is not carried over. */}
          <AnchorButton href="/" variant="outline" tone="surface">
            {t('errors.boundary.home')}
          </AnchorButton>
        </div>
      </section>
    </main>
  );
}
