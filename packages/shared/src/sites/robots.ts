import { NON_INDEXABLE_PATH_PREFIXES } from './indexing';

/**
 * `robots.txt` of a site (docs/SEO.md). Public content stays allowed; every non-indexable prefix gets a Disallow
 * line (sites/indexing.ts); the site's AI crawler policy adds a Disallow for the crawlers below.
 */

/** Whether the site lets AI training and answer crawlers read it (`SiteSeoSettings.aiCrawlers`). */
export const AI_CRAWLER_POLICIES = ['allow', 'block'] as const;
export type AiCrawlerPolicy = (typeof AI_CRAWLER_POLICIES)[number];
export const DEFAULT_AI_CRAWLER_POLICY: AiCrawlerPolicy = 'allow';

/** User-agent tokens of the AI crawlers a site can block: OpenAI, Anthropic, Common Crawl, Google AI training, Perplexity, ByteDance. */
export const AI_CRAWLER_USER_AGENTS = ['GPTBot', 'ClaudeBot', 'CCBot', 'Google-Extended', 'PerplexityBot', 'Bytespider', 'anthropic-ai'] as const;

export interface RobotsTxtOptions {
  /** `block` adds a `Disallow: /` group for every AI crawler; default `allow`. */
  aiCrawlers?: AiCrawlerPolicy;
}

export function buildRobotsTxt(sitemapUrl: string, options: RobotsTxtOptions = {}): string {
  const disallow = NON_INDEXABLE_PATH_PREFIXES.map((p) => `Disallow: ${p}/\nDisallow: ${p}$\n`).join('');
  const aiBlock = options.aiCrawlers === 'block' ? `${AI_CRAWLER_USER_AGENTS.map((agent) => `User-agent: ${agent}\n`).join('')}Disallow: /\n\n` : '';
  return `${aiBlock}User-agent: *\nAllow: /\n${disallow}Sitemap: ${sitemapUrl}\n`;
}
