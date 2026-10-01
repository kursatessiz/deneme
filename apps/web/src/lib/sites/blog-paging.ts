import { LocaleCodeSchema } from '@platform/shared';

/**
 * Blog pagination keeps its public `?page=N` URLs, but a page that reads `searchParams` cannot be cached (ISR,
 * docs/SEO.md). The middleware therefore rewrites `/<locale>/blog?page=N` and `/<locale>/blog/tag/<tag>?page=N`
 * (N >= 2) to the path-based routes `/<locale>/blog/page/N` and `/<locale>/blog/tag/<tag>/page/N`, which are
 * cached; page 1 has no query and is the plain route. The browser keeps the original URL.
 */
const BLOG_LIST_PATH = /^\/([^/]+)\/blog(\/tag\/[a-z0-9]+(?:-[a-z0-9]+)*)?\/?$/;
const PAGE_PARAM = /^[2-9]$|^[1-9][0-9]{1,3}$/;

/** A list page number from the path-based paging routes (2 to 9999); null otherwise (page 1 is the plain route). */
export function parseListPage(value: string): number | null {
  return PAGE_PARAM.test(value) ? Number(value) : null;
}

export function blogPagingRewrite(pathname: string, page: string | null): string | null {
  if (!page || !PAGE_PARAM.test(page)) return null;
  const match = BLOG_LIST_PATH.exec(pathname);
  if (!match || !LocaleCodeSchema.safeParse(match[1]).success) return null;
  return `/${match[1]}/blog${match[2] ?? ''}/page/${page}`;
}
