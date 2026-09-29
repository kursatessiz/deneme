import type { trMInvoices } from '../tr/mInvoices';

export const enMInvoices: Record<keyof typeof trMInvoices, string> = {
  'mInvoices.status.draft': 'Preparing',
  'mInvoices.status.issued': 'Issued',
  'mInvoices.status.cancelled': 'Cancelled',
  'mInvoices.status.failed': 'Failed',
  'mInvoices.noInvoicesYet': 'You have no invoices yet.',
  'mInvoices.viewInvoice': 'View invoice',
  'mInvoices.errors.loadFailed': 'Invoices could not be loaded.',
  'mInvoices.errors.noViewLinkYet': 'A view link for this invoice is not yet offered by the provider.',
  'mInvoices.errors.openFailed': 'Invoice could not be opened.',
};
