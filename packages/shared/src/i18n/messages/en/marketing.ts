import type { trMarketing } from '../tr/marketing';

export const enMarketing = {
  'marketing.layout.kicker': 'Platform marketing',
  'marketing.layout.title': 'Marketing panel',
  'marketing.layout.signedInAs': 'Signed in as {firstName} {lastName}',
  'marketing.layout.backToAdmin': 'Super admin panel',
  'marketing.layout.security': 'Security',
  'marketing.layout.contextFailed': 'The platform tenant could not be loaded. Please try again later.',

  'marketing.nav.dashboard': 'Dashboard',
  'marketing.nav.approvals': 'Approvals',
  'marketing.nav.calendar': 'Content calendar',
  'marketing.nav.aiStudio': 'AI studio',
  'marketing.nav.contacts': 'Contacts',
  'marketing.nav.segments': 'Segments',
  'marketing.nav.campaigns': 'Campaigns',
  'marketing.nav.journeys': 'Journeys',
  'marketing.nav.inbox': 'Inbox',
  'marketing.nav.templates': 'Message templates',
  'marketing.nav.site': 'Website',
  'marketing.nav.ads': 'Ads',
  'marketing.nav.reports': 'Reports',
  'marketing.nav.integrations': 'Integrations',
  'marketing.nav.brand': 'Brand kit',

  'marketing.ads.performance': 'Performance',
  'marketing.ads.settings': 'Connections and UTM',

  'marketing.placeholder.soon': 'This section arrives in a later phase.',
} as const satisfies Record<keyof typeof trMarketing, string>;
