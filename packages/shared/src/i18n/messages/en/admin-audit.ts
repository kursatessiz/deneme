import type { trAdminAudit } from '../tr/admin-audit';

export const enAdminAudit = {
  'adminAudit.nav': 'Audit',
  'adminAudit.title': 'Audit log',
  'adminAudit.subtitle': 'Administrative actions across every tenant, newest first. The details column is shortened so that it carries no personal data.',
  'adminAudit.accessDenied': 'You do not have access to this page.',
  'adminAudit.empty': 'No entries match the filters.',
  'adminAudit.system': 'System',
  'adminAudit.unknownUser': 'Deleted user',

  'adminAudit.filter.user': 'User ID',
  'adminAudit.filter.userPlaceholder': '00000000-0000-0000-0000-000000000000',
  'adminAudit.filter.userInvalid': 'The user ID must be a valid UUID.',
  'adminAudit.filter.action': 'Action',
  'adminAudit.filter.actionPlaceholder': 'marketing.approval',
  'adminAudit.filter.from': 'From',
  'adminAudit.filter.to': 'To',
  'adminAudit.filter.rangeInvalid': 'The start date cannot be after the end date.',
  'adminAudit.filter.apply': 'Filter',
  'adminAudit.filter.clear': 'Clear',

  'adminAudit.col.time': 'Time',
  'adminAudit.col.user': 'User',
  'adminAudit.col.action': 'Action',
  'adminAudit.col.target': 'Target',
  'adminAudit.col.details': 'Details',

  'adminAudit.page.previous': 'Previous',
  'adminAudit.page.next': 'Next',
  'adminAudit.page.info': 'Page {page} of {pages}, {total} entries',
} as const satisfies Record<keyof typeof trAdminAudit, string>;
