import { parseWebDomain, universalLinkSettings } from './universalLinks';

describe('parseWebDomain', () => {
  it('returns null when unset or blank', () => {
    expect(parseWebDomain(undefined)).toBeNull();
    expect(parseWebDomain('  ')).toBeNull();
  });

  it('accepts a bare host and lowercases it', () => {
    expect(parseWebDomain('Panel.Example.com')).toBe('panel.example.com');
  });

  it('rejects schemes, paths, ports and single labels', () => {
    for (const bad of ['https://panel.example.com', 'panel.example.com/j', 'panel.example.com:3000', 'localhost', 'a b.com']) {
      expect(() => parseWebDomain(bad)).toThrow();
    }
  });
});

describe('universalLinkSettings', () => {
  it('is empty without a domain', () => {
    expect(universalLinkSettings(null)).toEqual({ iosAssociatedDomains: [], androidIntentFilters: [] });
  });

  it('claims only /j/ on the domain with autoVerify', () => {
    const settings = universalLinkSettings('panel.example.com');
    expect(settings.iosAssociatedDomains).toEqual(['applinks:panel.example.com']);
    expect(settings.androidIntentFilters).toEqual([
      { action: 'VIEW', autoVerify: true, data: [{ scheme: 'https', host: 'panel.example.com', pathPrefix: '/j/' }], category: ['BROWSABLE', 'DEFAULT'] },
    ]);
  });
});
