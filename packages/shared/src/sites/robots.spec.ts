import { AI_CRAWLER_USER_AGENTS, NON_INDEXABLE_PATH_PREFIXES, buildRobotsTxt } from './index';

describe('sites/robots.txt', () => {
  const sitemap = 'https://x.com/sitemap.xml';

  it('allows public content, disallows every non-indexable prefix and names the sitemap', () => {
    const txt = buildRobotsTxt(sitemap);
    expect(txt).toContain('User-agent: *\nAllow: /\n');
    for (const prefix of NON_INDEXABLE_PATH_PREFIXES) {
      expect(txt).toContain(`Disallow: ${prefix}/`);
      expect(txt).toContain(`Disallow: ${prefix}$`);
    }
    expect(txt.trimEnd().endsWith(`Sitemap: ${sitemap}`)).toBe(true);
  });

  it('names no AI crawler by default or when allowed', () => {
    for (const txt of [buildRobotsTxt(sitemap), buildRobotsTxt(sitemap, {}), buildRobotsTxt(sitemap, { aiCrawlers: 'allow' })]) {
      for (const agent of AI_CRAWLER_USER_AGENTS) expect(txt).not.toContain(agent);
    }
  });

  it('blocks exactly the seven AI crawlers when the policy is block', () => {
    expect([...AI_CRAWLER_USER_AGENTS]).toEqual(['GPTBot', 'ClaudeBot', 'CCBot', 'Google-Extended', 'PerplexityBot', 'Bytespider', 'anthropic-ai']);
    const txt = buildRobotsTxt(sitemap, { aiCrawlers: 'block' });
    const group = txt.split('\n\n')[0];
    for (const agent of AI_CRAWLER_USER_AGENTS) expect(group).toContain(`User-agent: ${agent}\n`);
    expect(group.endsWith('Disallow: /')).toBe(true);
  });

  it('keeps the rules for every other agent when blocking', () => {
    const txt = buildRobotsTxt(sitemap, { aiCrawlers: 'block' });
    expect(txt).toContain('\n\nUser-agent: *\nAllow: /\n');
    expect(txt).toContain(`Sitemap: ${sitemap}`);
  });
});
