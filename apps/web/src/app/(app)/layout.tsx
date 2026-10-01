import type { Metadata, Viewport } from 'next';
// Order matters: globals.css declares the cascade layer order before the kit's own layers appear.
import '../globals.css';
import '@chrissgon/perfectui/perfectui.css';
import { RootDocument } from '@/components/layout/RootDocument';
import { resolveRequestLocale } from '@/lib/i18n/locale';
import { getLocaleMessages } from '@/lib/i18n/messages';
import { getT } from '@/lib/i18n/getT';
import { buildRootMetadata } from '@/lib/seo/root-metadata';
import { PLATFORM_BRAND } from '@/lib/seo/brand';

/** Root layout of the panel, login, booking and token pages: the locale is resolved per request, so these render per request. */
export async function generateMetadata(): Promise<Metadata> {
  const { t, locale } = await getT();
  return buildRootMetadata(t, locale);
}

export const viewport: Viewport = { themeColor: PLATFORM_BRAND.primary };

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await resolveRequestLocale();
  const messages = await getLocaleMessages(locale);
  return (
    <RootDocument locale={locale} messages={messages}>
      {children}
    </RootDocument>
  );
}
