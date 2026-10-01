import type { Metadata, Viewport } from 'next';
import { PRODUCT_NAME } from '@platform/shared';
// Order matters: globals.css declares the cascade layer order before the kit's own layers appear.
import './globals.css';
import '@chrissgon/perfectui/perfectui.css';
import { I18nProvider } from '@/components/i18n/I18nProvider';
import { resolveRequestLocale } from '@/lib/i18n/locale';
import { getLocaleMessages } from '@/lib/i18n/messages';
import { ErrorReporter } from '@/components/errors/ErrorReporter';
import { getServerEnv } from '@/lib/server-env';
import { PUBLIC_API_URL_META, serverPublicApiUrl } from '@/lib/public-api-url';
import { getT } from '@/lib/i18n/getT';
import { siteOrigin } from '@/lib/sites/origin';
import { PLATFORM_BRAND } from '@/lib/seo/brand';
import { toOgLocale } from '@/lib/seo/og-locale';

/**
 * Site-wide defaults (docs/SEO.md). A route that sets its own `openGraph`
 * replaces this object (Next.js merges metadata shallowly), so such routes
 * repeat `type`, `siteName` and `locale`; `alternates` is never set here.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { t, locale } = await getT();
  const title = t('seo.root.title', { product: PRODUCT_NAME });
  const description = t('seo.root.description');
  return {
    metadataBase: new URL(siteOrigin('platform', true)),
    title,
    description,
    applicationName: PRODUCT_NAME,
    openGraph: { type: 'website', siteName: PRODUCT_NAME, locale: toOgLocale(locale), title, description },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export const viewport: Viewport = { themeColor: PLATFORM_BRAND.primary };

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await resolveRequestLocale();
  const messages = await getLocaleMessages(locale);
  const env = getServerEnv();

  return (
    <html lang={locale}>
      <head>
        {/* Runtime API origin for client code (lib/public-api-url.ts); read per request, never inlined at build. */}
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
