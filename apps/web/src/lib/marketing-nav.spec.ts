import { DEFAULT_PLATFORM_ROLE_TEMPLATES } from '@platform/shared';
import { MARKETING_NAV_ITEMS, activeMarketingItem, filterMarketingNav, hasAnyPlatformPermission } from './marketing-nav';
import { areaHref } from '../components/session/AreaBase';

describe('marketing nav', () => {
  const marketingAdmin = DEFAULT_PLATFORM_ROLE_TEMPLATES.find((t) => t.key === 'marketing_admin')!.permissions;

  it('every item lives under /pazarlama', () => {
    for (const item of MARKETING_NAV_ITEMS) expect(item.href === '/pazarlama' || item.href.startsWith('/pazarlama/')).toBe(true);
  });

  it('super admins see everything; the marketing admin sees everything but approvals-only screens they lack', () => {
    expect(filterMarketingNav(MARKETING_NAV_ITEMS, [], true)).toHaveLength(MARKETING_NAV_ITEMS.length);
    const keys = filterMarketingNav(MARKETING_NAV_ITEMS, marketingAdmin, false).map((i) => i.key);
    expect(keys).toEqual(expect.arrayContaining(['dashboard', 'contacts', 'integrations', 'aiStudio', 'brand', 'approvals']));
  });

  it('an ads-only role sees only the ads screen', () => {
    expect(filterMarketingNav(MARKETING_NAV_ITEMS, ['platform.ads.view'], false).map((i) => i.key)).toEqual(['ads']);
    expect(hasAnyPlatformPermission(['platform.brand.manage'], ['platform.ads.view'], false)).toBe(false);
  });

  it('marks the most specific item active', () => {
    expect(activeMarketingItem(MARKETING_NAV_ITEMS, '/pazarlama')).toBe('dashboard');
    expect(activeMarketingItem(MARKETING_NAV_ITEMS, '/pazarlama/kisiler/abc')).toBe('contacts');
    expect(activeMarketingItem(MARKETING_NAV_ITEMS, '/pazarlama/reklam/ayarlar')).toBe('ads');
  });
});

describe('areaHref', () => {
  it('prefixes app paths in the marketing shell and leaves the tenant dashboard untouched', () => {
    expect(areaHref('/pazarlama', '/kisiler/1')).toBe('/pazarlama/kisiler/1');
    expect(areaHref('', '/kisiler/1')).toBe('/kisiler/1');
    expect(areaHref('/pazarlama', 'https://example.com/x')).toBe('https://example.com/x');
    expect(areaHref('/pazarlama', '//evil.example')).toBe('//evil.example');
  });
});
