import { blogFeedResponse } from '@/lib/sites/blog-feed';

/** RSS 2.0 feed of a tenant site's blog in one locale (S2b), on the tenant's own origin. */
export async function GET(_request: Request, { params }: { params: Promise<{ studioSlug: string; locale: string }> }): Promise<Response> {
  const { studioSlug, locale } = await params;
  return blogFeedResponse(studioSlug, false, locale);
}
