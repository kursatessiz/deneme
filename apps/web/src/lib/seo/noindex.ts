import type { Metadata } from 'next';
import { PRODUCT_NAME } from '@platform/shared';
import type { MessageKey } from '@platform/shared';
import { getT } from '@/lib/i18n/getT';

/**
 * Metadata for pages that must never be indexed (docs/SEO.md): a robots
 * meta tag plus a neutral, translated title. The middleware sets the same
 * decision as an X-Robots-Tag header from the shared prefix list, which also
 * covers route handlers and client-rendered pages without a layout.
 */
export async function noindexMetadata(titleKey: Extract<MessageKey, 'seo.login.title' | 'seo.token.title' | 'seo.panel.title'>): Promise<Metadata> {
  const { t } = await getT();
  return { title: t(titleKey, { product: PRODUCT_NAME }), robots: { index: false, follow: false } };
}
