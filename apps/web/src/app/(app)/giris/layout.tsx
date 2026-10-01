import type { Metadata } from 'next';
import { noindexMetadata } from '@/lib/seo/noindex';

/** Not indexable (docs/SEO.md): neutral title and robots meta; the page itself is a client component. */
export async function generateMetadata(): Promise<Metadata> {
  return noindexMetadata('seo.login.title');
}

export default function NoindexLayout({ children }: { children: React.ReactNode }) {
  return children;
}
