import type { Metadata, Viewport } from 'next';
// Order matters: globals.css declares the cascade layer order before the kit's own layers appear.
import '../../../globals.css';
import '@chrissgon/perfectui/perfectui.css';
import { SiteRootLayout, siteRootMetadata } from '@/components/layout/SiteRootLayout';
import { PLATFORM_BRAND } from '@/lib/seo/brand';

/** Root layout of a tenant's site: locale from the URL, no per-request reads (docs/SEO.md "ISR"). */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return siteRootMetadata((await params).locale);
}

export const viewport: Viewport = { themeColor: PLATFORM_BRAND.primary };

export default async function TenantSiteLayout({ children, params }: { children: React.ReactNode; params: Promise<{ studioSlug: string; locale: string }> }) {
  return <SiteRootLayout urlLocale={(await params).locale}>{children}</SiteRootLayout>;
}
