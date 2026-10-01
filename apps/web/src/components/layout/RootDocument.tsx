import { I18nProvider } from '@/components/i18n/I18nProvider';
import { ErrorReporter } from '@/components/errors/ErrorReporter';
import { getServerEnv } from '@/lib/server-env';
import { PUBLIC_API_URL_META, serverPublicApiUrl } from '@/lib/public-api-url';

/**
 * The `<html>` document every root layout renders: language, the runtime API origin meta, the i18n provider
 * and the error reporter. The app root layout (`app/(app)/layout.tsx`) resolves the locale per request; the
 * page engine's root layouts (`app/[locale]/layout.tsx`, `app/tenant-site/.../[locale]/layout.tsx`) take it
 * from the URL so their pages can be cached (ISR, docs/SEO.md).
 */
export function RootDocument({ locale, messages, children }: { locale: string; messages: Record<string, string>; children: React.ReactNode }) {
  const env = getServerEnv();
  return (
    <html lang={locale}>
      <head>
        {/* Runtime API origin for client code (lib/public-api-url.ts); read at render, never inlined at build. */}
        <meta name={PUBLIC_API_URL_META} content={serverPublicApiUrl()} />
      </head>
      <body className="antialiased">
        <I18nProvider locale={locale} messages={messages}>
          <ErrorReporter release={env.APP_RELEASE} environment={env.NODE_ENV} />
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
