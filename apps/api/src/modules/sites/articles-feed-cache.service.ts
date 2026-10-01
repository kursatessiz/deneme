import { Injectable } from '@nestjs/common';

const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 500;

/**
 * In-process cache of rendered RSS feeds, keyed by site and locale. Five
 * minutes at most, and dropped for a site on every article or tag write, so
 * a publish shows up at once. Single API instance (6 GB box), hence no Redis.
 */
@Injectable()
export class ArticlesFeedCache {
  private readonly entries = new Map<string, { xml: string; expiresAt: number }>();

  get(siteId: string, locale: string): string | null {
    const entry = this.entries.get(`${siteId}:${locale}`);
    if (!entry || entry.expiresAt <= Date.now()) return null;
    return entry.xml;
  }

  set(siteId: string, locale: string, xml: string): void {
    if (this.entries.size >= MAX_ENTRIES) this.entries.clear();
    this.entries.set(`${siteId}:${locale}`, { xml, expiresAt: Date.now() + TTL_MS });
  }

  invalidateSite(siteId: string): void {
    for (const key of this.entries.keys()) if (key.startsWith(`${siteId}:`)) this.entries.delete(key);
  }
}
