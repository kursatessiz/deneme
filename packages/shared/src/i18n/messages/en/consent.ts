import type { trConsent } from '../tr/consent';

export const enConsent: Record<keyof typeof trConsent, string> = {
  'consent.title': 'Cookie preferences',
  'consent.optIn.body':
    'We would like to use optional cookies to improve our site and measure how our ads perform. None of them are set unless you agree.',
  'consent.kvkk.body':
    'Under the Turkish data protection law (KVKK), your personal data is processed with cookies to measure your visit and improve our ads only if you consent. You can withdraw your consent at any time.',
  'consent.notice.body':
    'We use cookies to improve our site and measure how our ads perform. You can turn advertising cookies off below.',
  'consent.gpcHonoured': 'Advertising cookies are off because your browser sends a Global Privacy Control signal.',
  'consent.category.necessary': 'Necessary',
  'consent.category.necessaryHint': 'Needed to remember your choice, always on.',
  'consent.category.analytics': 'Analytics',
  'consent.category.analyticsHint': 'Measures visits and where you came from.',
  'consent.category.advertising': 'Advertising',
  'consent.category.advertisingHint': 'Measures ad clicks and shares them with ad platforms.',
  'consent.acceptAll': 'Accept all',
  'consent.rejectAll': 'Reject all',
  'consent.customize': 'Choose preferences',
  'consent.save': 'Save my choice',
  'consent.ok': 'OK',
  'consent.optOutAdvertising': 'Turn off advertising cookies',
};
