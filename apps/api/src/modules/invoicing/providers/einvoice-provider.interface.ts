import type { EInvoiceCancelResult, EInvoiceIssueResult } from '@platform/shared';
import { EInvoiceProvider } from '@platform/database';

export interface InvoiceBuyer {
  kind: 'INDIVIDUAL' | 'COMPANY';
  fullName?: string;
  tckn?: string;
  companyTitle?: string;
  vkn?: string;
  taxOffice?: string;
  address?: string;
  email?: string;
}

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface IssueInvoiceParams {
  studioId: string;
  /** Our own invoice id; the adapter must be able to derive an idempotency key from it. */
  invoiceId: string;
  number: string;
  issueDate: Date;
  seller: { legalName: string; taxOffice?: string; taxNumber?: string; address?: string };
  buyer: InvoiceBuyer;
  lines: InvoiceLine[];
  subtotal: number;
  vatAmount: number;
  vatRate: number;
  total: number;
  currency: string;
}

export interface CancelInvoiceParams {
  studioId: string;
  providerUuid: string;
  reason: string;
}

export interface GetPdfResult {
  contentType: string;
  body: Buffer;
}

/**
 * Adapter contract every e-invoice integrator implements, mirroring the
 * PaymentProviderAdapter pattern in ../../payments/providers. Only MOCK is
 * fully implemented; the others are skeletons documenting the request
 * shapes for a follow-up PR, and MOCK is disabled in production because
 * issuing one would falsely claim a legal document was created.
 */
export interface EInvoiceProviderAdapter {
  readonly name: EInvoiceProvider;

  issue(params: IssueInvoiceParams): Promise<EInvoiceIssueResult>;
  cancel(params: CancelInvoiceParams): Promise<EInvoiceCancelResult>;
  getStatus(studioId: string, providerUuid: string): Promise<{ status: string }>;
  getPdf(studioId: string, providerUuid: string): Promise<GetPdfResult>;
}

export const EINVOICE_PROVIDER_ADAPTER = Symbol('EINVOICE_PROVIDER_ADAPTER');
