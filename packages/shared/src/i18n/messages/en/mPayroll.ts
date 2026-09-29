import type { trMPayroll } from '../tr/mPayroll';

export const enMPayroll: Record<keyof typeof trMPayroll, string> = {
  'mPayroll.status.draft': 'Draft',
  'mPayroll.status.approved': 'Approved',
  'mPayroll.status.paid': 'Paid',
  'mPayroll.caption': 'Trainer commission payroll runs.',
  'mPayroll.noRunsYet': 'No payroll run created yet.',
  'mPayroll.approve': 'Approve',
  'mPayroll.markPaid': 'Mark as paid',
  'mPayroll.errors.loadFailed': 'Payroll runs could not be loaded.',
  'mPayroll.errors.approveFailed': 'Payroll could not be approved.',
  'mPayroll.errors.markPaidFailed': 'Payroll could not be marked as paid.',
  'mPayroll.commissionCaption': 'Your commission from approved and paid payroll periods.',
  'mPayroll.noCommissionRecordsYet': "You don't have any approved commission records yet.",
  'mPayroll.metric.sessions': 'Sessions',
  'mPayroll.metric.attendees': 'Attendees',
  'mPayroll.metric.gross': 'Gross',
  'mPayroll.metric.adjustment': 'Adjustment',
  'mPayroll.errors.commissionLoadFailed': 'Commission info could not be loaded.',
};
