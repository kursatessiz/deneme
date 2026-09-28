import type { trCrm } from '../tr/crm';

export const enCrm: Record<keyof typeof trCrm, string> = {
  'crm.stage.NEW': 'New',
  'crm.stage.CONTACTED': 'Contacted',
  'crm.stage.TRIAL_BOOKED': 'Trial booked',
  'crm.stage.TRIAL_DONE': 'Trial done',
  'crm.stage.WON': 'Won',
  'crm.stage.LOST': 'Lost',
  'crm.lifecycle.LEAD': 'Lead',
  'crm.lifecycle.TRIAL': 'Trial',
  'crm.lifecycle.MEMBER': 'Active',
  'crm.lifecycle.LAPSED': 'Lapsed',
  'crm.lifecycle.LOST': 'Lost',
  'crm.fieldKind.string': 'Text',
  'crm.fieldKind.number': 'Number',
  'crm.fieldKind.date': 'Date',
  'crm.fieldKind.boolean': 'Yes / no',
  'crm.fieldKind.enum': 'Choice list',
  'crm.task.OPEN': 'Open',
  'crm.task.DONE': 'Done',
  'crm.task.CANCELLED': 'Cancelled',
};
