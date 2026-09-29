import type { trAdminBusinessTypes } from '../tr/admin-business-types';

export const enAdminBusinessTypes = {
  'adminBusinessTypes.title': 'Business Type Templates',
  'adminBusinessTypes.subtitle':
    'Default service/resource types, vocabulary and enabled modules. Applied to a new tenant with "Apply".',
  'adminBusinessTypes.form.title': 'Create / update template',
  'adminBusinessTypes.form.key': 'Key (e.g. yoga_studio)',
  'adminBusinessTypes.form.name': 'Name',
  'adminBusinessTypes.form.serviceTypes': 'Service types (comma-separated)',
  'adminBusinessTypes.form.resourceTypes': 'Resource types (comma-separated)',
  'adminBusinessTypes.form.enabledModules': 'Enabled modules (comma-separated)',
  'adminBusinessTypes.form.saveFailed': 'Could not save',
  'adminBusinessTypes.form.submit': 'Save',
  'adminBusinessTypes.form.submitting': 'Saving...',
  'adminBusinessTypes.accessDenied': 'No access',
  'adminBusinessTypes.modules': 'Modules: {modules}',
} as const satisfies Record<keyof typeof trAdminBusinessTypes, string>;
