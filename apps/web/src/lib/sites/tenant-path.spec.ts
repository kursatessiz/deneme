import { tenantRewritePath } from './tenant-path';

describe('tenantRewritePath', () => {
  it('sends page engine paths to the tenant-site tree', () => {
    expect(tenantRewritePath('zen', '/')).toBe('/tenant-site/zen/');
    expect(tenantRewritePath('zen', '/tr/pilates')).toBe('/tenant-site/zen/tr/pilates');
  });

  it('maps the events paths to the studio public event pages', () => {
    expect(tenantRewritePath('zen', '/events')).toBe('/events/zen');
    expect(tenantRewritePath('zen', '/events/yoga-1')).toBe('/events/zen/yoga-1');
  });

  it('does not treat a longer first segment as events', () => {
    expect(tenantRewritePath('zen', '/events-archive')).toBe('/tenant-site/zen/events-archive');
  });
});
