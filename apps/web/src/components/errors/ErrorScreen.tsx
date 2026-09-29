'use client';

import { useEffect, useState } from 'react';
import type { Translate } from '@platform/shared';
import { reportError } from '@/lib/errors/reporter';

/**
 * The friendly error screen of error.tsx and global-error.tsx: reports the
 * error once and shows the short code support can search for. `t` comes
 * from the caller because global-error renders outside I18nProvider.
 */
export function ErrorScreen({ error, reset, t }: { error: Error & { digest?: string }; reset: () => void; t: Translate }) {
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    // The digest links a server-rendering error to the server log line.
    setCode(reportError(error, { severity: 'fatal', extra: error.digest ? `digest ${error.digest}` : undefined }));
  }, [error]);

  return (
    <main className="min-h-[60vh] flex items-center justify-center px-4 py-16" style={{ color: 'var(--color-text-primary)' }}>
      <section aria-labelledby="error-screen-title" className="max-w-md w-full space-y-4">
        <h1 id="error-screen-title" className="text-2xl font-bold tracking-tight">
          {t('errors.boundary.title')}
        </h1>
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          {t('errors.boundary.description')}
        </p>
        {code && (
          <div className="space-y-1">
            <p className="text-sm font-medium" data-testid="error-code">
              {t('errors.boundary.code', { code })}
            </p>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {t('errors.boundary.codeHint')}
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-3 pt-2">
          <button
            type="button"
            onClick={reset}
            className="px-4 py-2 text-sm font-medium"
            style={{ borderRadius: 'var(--radius-button)', backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }}
          >
            {t('errors.boundary.retry')}
          </button>
          {/* A full navigation, so a broken client state is not carried over. */}
          <a href="/" className="px-4 py-2 text-sm font-medium border" style={{ borderRadius: 'var(--radius-button)', borderColor: 'var(--color-border)' }}>
            {t('errors.boundary.home')}
          </a>
        </div>
      </section>
    </main>
  );
}
