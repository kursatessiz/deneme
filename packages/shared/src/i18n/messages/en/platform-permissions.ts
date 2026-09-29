import type { trPlatformPermissions } from '../tr/platform-permissions';

export const enPlatformPermissions = {
  'platformPermissions.marketingView': 'View the marketing panel and reports',
  'platformPermissions.marketingManage': 'Edit contacts, segments, campaigns, journeys, templates and the site',
  'platformPermissions.marketingSend': 'Start sends below the approval threshold',
  'platformPermissions.marketingApprove': 'Approve send and spend requests',
  'platformPermissions.inboxReply': 'Reply in the inbox',
  'platformPermissions.adsView': 'View ad performance',
  'platformPermissions.adsManage': 'Ad connections and UTM',
  'platformPermissions.adsSpend': 'Request budget changes and activation',
  'platformPermissions.socialPublish': 'Schedule organic social posts',
  'platformPermissions.integrationsManage': 'Marketing integrations',
  'platformPermissions.aiUse': 'AI studio',
  'platformPermissions.brandManage': 'Brand kit and product facts',
  'platformPermissions.contactsExport': 'Export the contact list',
  'platformPermissions.referralsView': 'Business referral report',
  'platformPermissions.usersManage': 'Manage platform users',
} as const satisfies Record<keyof typeof trPlatformPermissions, string>;
