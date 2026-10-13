/**
 * Universal links / app links for the invite landing `/j/<token>`: the association files that let the
 * mobile app claim `https://<WEB_DOMAIN>/j/*` (docs/MOBILE_APP.md "Evrensel baglantilar"). Every value is
 * owner configuration read from the environment (no app identifier is committed); with nothing configured
 * the endpoints answer 404 and the link keeps opening the web page.
 */

/** The only path space the app claims. */
export const UNIVERSAL_LINK_PATHS = ['/j/*'] as const;

/** iOS application identifier: `<10 character team id>.<bundle id>`. */
const IOS_APP_ID_PATTERN = /^[A-Z0-9]{10}\.[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)+$/;
const ANDROID_PACKAGE_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
/** SHA-256 certificate fingerprint: 32 colon separated hex bytes. */
const FINGERPRINT_PATTERN = /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/;

export interface UniversalLinkConfig {
  iosAppIds: string[];
  androidPackage: string | null;
  androidFingerprints: string[];
}

/** Comma separated list to trimmed, de-duplicated, non-empty items. */
export function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.split(',').map((item) => item.trim()).filter((item) => item !== ''))];
}

/** Returns the problems of the raw env values (empty when valid); used by the server env validation. */
export function universalLinkEnvProblems(raw: { iosAppIds?: string; androidPackage?: string; androidFingerprints?: string }): string[] {
  const problems: string[] = [];
  for (const id of splitList(raw.iosAppIds)) {
    if (!IOS_APP_ID_PATTERN.test(id)) problems.push(`MOBILE_IOS_APP_IDS: "${id}" is not TEAMID.bundle.id`);
  }
  const pkg = raw.androidPackage?.trim() ?? '';
  const fingerprints = splitList(raw.androidFingerprints);
  if (pkg !== '' && !ANDROID_PACKAGE_PATTERN.test(pkg)) problems.push(`MOBILE_ANDROID_PACKAGE: "${pkg}" is not a package name`);
  for (const fp of fingerprints) {
    if (!FINGERPRINT_PATTERN.test(fp.toUpperCase())) problems.push(`MOBILE_ANDROID_SHA256_CERT_FINGERPRINTS: "${fp}" is not a SHA-256 fingerprint (AA:BB:...)`);
  }
  if ((pkg !== '') !== (fingerprints.length > 0)) {
    problems.push('MOBILE_ANDROID_PACKAGE and MOBILE_ANDROID_SHA256_CERT_FINGERPRINTS must be set together');
  }
  return problems;
}

export function parseUniversalLinkConfig(raw: { iosAppIds?: string; androidPackage?: string; androidFingerprints?: string }): UniversalLinkConfig {
  const pkg = raw.androidPackage?.trim() ?? '';
  return {
    iosAppIds: splitList(raw.iosAppIds),
    androidPackage: pkg === '' ? null : pkg,
    androidFingerprints: splitList(raw.androidFingerprints).map((fp) => fp.toUpperCase()),
  };
}

/** `apple-app-site-association` body, or null when no iOS app is configured. Claims only `/j/*`. */
export function buildAppleAppSiteAssociation(config: UniversalLinkConfig): object | null {
  if (config.iosAppIds.length === 0) return null;
  return {
    applinks: {
      details: [{ appIDs: config.iosAppIds, components: [{ '/': UNIVERSAL_LINK_PATHS[0] }] }],
    },
  };
}

/** `assetlinks.json` body, or null when no Android app is configured. */
export function buildAssetLinks(config: UniversalLinkConfig): object[] | null {
  if (!config.androidPackage || config.androidFingerprints.length === 0) return null;
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: config.androidPackage, sha256_cert_fingerprints: config.androidFingerprints },
    },
  ];
}
