import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Build variants on top of app.json. eas.json sets APP_VARIANT per build
 * profile; local `expo start` leaves it unset and gets app.json unchanged.
 *
 * - preprod: its own name and bundle identifier, so it installs next to the
 *   store app and can never be confused with it.
 * - The API URL is never committed: EXPO_PUBLIC_API_URL comes from the EAS
 *   environment of the profile (`eas env:create --environment preview|production
 *   --name EXPO_PUBLIC_API_URL ...`, docs/CICD_GUIDE.md "Preprod ortamı").
 *   A preprod or production EAS build without an https value fails here
 *   instead of shipping an app that talks to localhost.
 */

type Variant = 'preprod' | 'production';

const VARIANTS: Record<Variant, { nameSuffix: string; idSuffix: string }> = {
  preprod: { nameSuffix: ' Preprod', idSuffix: '.preprod' },
  production: { nameSuffix: '', idSuffix: '' },
};

function variantOf(value: string | undefined): Variant | null {
  if (value === undefined || value === '') return null;
  if (value === 'preprod' || value === 'production') return value;
  throw new Error(`Unknown APP_VARIANT "${value}" (expected preprod or production)`);
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = variantOf(process.env.APP_VARIANT);
  const name = config.name ?? 'Platform';
  const slug = config.slug ?? 'platform-app';
  if (!variant) return { ...config, name, slug };

  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
  if (process.env.EAS_BUILD === 'true' && !/^https:\/\/[^/\s]+/.test(apiUrl)) {
    throw new Error(`EXPO_PUBLIC_API_URL must be an https URL for the ${variant} build (set it in the EAS environment)`);
  }

  const { nameSuffix, idSuffix } = VARIANTS[variant];
  return {
    ...config,
    name: `${name}${nameSuffix}`,
    slug,
    // Read by the error reporter as the environment of reported errors.
    extra: { ...config.extra, appVariant: variant },
    ios: { ...config.ios, bundleIdentifier: config.ios?.bundleIdentifier ? `${config.ios.bundleIdentifier}${idSuffix}` : undefined },
    android: { ...config.android, package: config.android?.package ? `${config.android.package}${idSuffix}` : undefined },
  };
};
