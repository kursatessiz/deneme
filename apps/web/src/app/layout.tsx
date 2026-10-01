import type { Metadata } from 'next';
// Order matters: globals.css declares the cascade layer order before the kit's own layers appear.
import './globals.css';
import '@chrissgon/perfectui/perfectui.css';
import { I18nProvider } from '@/components/i18n/I18nProvider';
import { resolveRequestLocale } from '@/lib/i18n/locale';
import { getLocaleMessages } from '@/lib/i18n/messages';
import { ErrorReporter } from '@/components/errors/ErrorReporter';
import { getServerEnv } from '@/lib/server-env';
import { PUBLIC_API_URL_META, serverPublicApiUrl } from '@/lib/public-api-url';

export const metadata: Metadata = {
  title: 'Platform | Akıllı Randevu ve Üyelik Yönetim Sistemi',
  description: 'Randevu, üyelik kredisi, personel ve müşteri yönetim platformu',
};

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
