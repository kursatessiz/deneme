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

  it('a read-only role sees the brand kit and the calendar but not the AI studio', () => {
    const keys = filterMarketingNav(MARKETING_NAV_ITEMS, ['platform.marketing.view'], false).map((i) => i.key);
    expect(keys).toEqual(expect.arrayContaining(['brand', 'calendar']));
    expect(keys).not.toContain('aiStudio');
  });

  it('the AI studio and brand kit live at their M2 routes', () => {
    const href = (key: string) => MARKETING_NAV_ITEMS.find((i) => i.key === key)?.href;
    expect(href('aiStudio')).toBe('/pazarlama/yapay-zeka');
    expect(href('brand')).toBe('/pazarlama/marka');
    expect(href('calendar')).toBe('/pazarlama/takvim');
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
