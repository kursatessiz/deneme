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
  'marketing.placeholder.dashboard.title': 'Marketing dashboard',
  'marketing.placeholder.dashboard.description':
    'Funnel, cost and channel health indicators arrive here in phase M3. For now, use the menu to reach contacts, campaigns and reports.',
  'marketing.placeholder.approvals.title': 'Approvals',
  'marketing.placeholder.approvals.description': 'Send and spend requests above the threshold will be approved here in phase M3.',
  'marketing.placeholder.calendar.title': 'Content calendar',
  'marketing.placeholder.calendar.description': 'Campaigns, journeys and posts will share one calendar in phase M2.',
  'marketing.placeholder.aiStudio.title': 'AI studio',
  'marketing.placeholder.aiStudio.description': 'Multi-channel drafts from a brief arrive in phase M2. AI never sends anything without approval.',
  'marketing.placeholder.brand.title': 'Brand kit',
  'marketing.placeholder.brand.description': 'Brand voice, banned phrases and product facts will be edited here in phase M2.',
} as const satisfies Record<keyof typeof trMarketing, string>;
