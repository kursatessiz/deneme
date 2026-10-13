import { buildAppleAppSiteAssociation, buildAssetLinks, parseUniversalLinkConfig, splitList, universalLinkEnvProblems } from './universal-links';

const FP = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0').toUpperCase()).join(':');

describe('universal links', () => {
  it('returns nothing when nothing is configured', () => {
    const config = parseUniversalLinkConfig({});
    expect(buildAppleAppSiteAssociation(config)).toBeNull();
    expect(buildAssetLinks(config)).toBeNull();
    expect(universalLinkEnvProblems({})).toEqual([]);
  });

  it('builds an association that claims only /j/*', () => {
    const config = parseUniversalLinkConfig({ iosAppIds: 'ABCDE12345.com.platform.member, ABCDE12345.com.platform.member.preprod' });
    expect(buildAppleAppSiteAssociation(config)).toEqual({
      applinks: { details: [{ appIDs: ['ABCDE12345.com.platform.member', 'ABCDE12345.com.platform.member.preprod'], components: [{ '/': '/j/*' }] }] },
    });
  });

  it('builds asset links with uppercase fingerprints', () => {
    const config = parseUniversalLinkConfig({ androidPackage: 'com.platform.member', androidFingerprints: FP.toLowerCase() });
    expect(buildAssetLinks(config)).toEqual([
      { relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: 'com.platform.member', sha256_cert_fingerprints: [FP] } },
    ]);
  });

  it('validates the raw values', () => {
    expect(universalLinkEnvProblems({ iosAppIds: 'nope' })).toHaveLength(1);
    expect(universalLinkEnvProblems({ androidPackage: 'com.platform.member' })).toHaveLength(1);
    expect(universalLinkEnvProblems({ androidFingerprints: FP })).toHaveLength(1);
    expect(universalLinkEnvProblems({ androidPackage: 'bad package', androidFingerprints: 'AA' })).toHaveLength(2);
    expect(universalLinkEnvProblems({ iosAppIds: 'ABCDE12345.com.platform.member', androidPackage: 'com.platform.member', androidFingerprints: FP })).toEqual([]);
  });

  it('splits and de-duplicates lists', () => {
    expect(splitList(' a, b ,,a')).toEqual(['a', 'b']);
    expect(splitList(undefined)).toEqual([]);
  });
});
