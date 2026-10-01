import { blogFeedResponse } from '@/lib/sites/blog-feed';

/** RSS 2.0 feed of the platform blog in one locale (S2b), on the platform origin. */
export async function GET(_request: Request, { params }: { params: Promise<{ locale: string }> }): Promise<Response> {
  const { locale } = await params;
  return blogFeedResponse('platform', true, locale);
}
