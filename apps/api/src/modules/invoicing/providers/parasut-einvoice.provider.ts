import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EInvoiceProvider } from '@platform/database';
import type { EInvoiceCancelResult, EInvoiceIssueResult } from '@platform/shared';
import type {
  CancelInvoiceParams,
  EInvoiceProviderAdapter,
  GetPdfResult,
  IssueInvoiceParams,
} from './einvoice-provider.interface';

/**
 * Parasut e-Arsiv/e-Fatura adapter skeleton. Real HTTP calls are not
 * implemented; every method throws a clear configuration error, and the
 * request shapes below document the integration for a follow-up PR.
 *
 * TODO(W8-follow-up): implement the real Parasut e-Document API.
 *   - OAuth2 client-credentials token from https://api.parasut.com/oauth/token
 *     using PARASUT_CLIENT_ID / PARASUT_CLIENT_SECRET / PARASUT_USERNAME / PARASUT_PASSWORD.
 *   - issue: POST /v4/{company_id}/e_archives (or /e_invoices for EFATURA)
 *       body: JSON:API resource with buyer contact, sales_invoice_id, and vat/withholding breakdown.
 *   - cancel: DELETE /v4/{company_id}/e_archives/{id} within the GIB cancellation window (see docs/INVOICING.md).
 *   - getStatus/getPdf: GET /v4/{company_id}/e_archives/{id} and its `/pdf` relation link.
 */
@Injectable()
export class ParasutEInvoiceProvider implements EInvoiceProviderAdapter {
  readonly name = EInvoiceProvider.PARASUT;

  constructor(private readonly config: ConfigService) {}

  private assertConfigured(): void {
    const clientId = this.config.get<string>('PARASUT_CLIENT_ID');
    const clientSecret = this.config.get<string>('PARASUT_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      throw new InternalServerErrorException(
        'Paraşüt e-fatura sağlayıcısı yapılandırılmamış: PARASUT_CLIENT_ID ve PARASUT_CLIENT_SECRET gereklidir',
      );
    }
  }

  async issue(_params: IssueInvoiceParams): Promise<EInvoiceIssueResult> {
    this.assertConfigured();
    throw new InternalServerErrorException('Paraşüt entegrasyonu henüz uygulanmadı');
  }

  async cancel(_params: CancelInvoiceParams): Promise<EInvoiceCancelResult> {
    this.assertConfigured();
    throw new InternalServerErrorException('Paraşüt entegrasyonu henüz uygulanmadı');
  }

  async getStatus(): Promise<{ status: string }> {
    this.assertConfigured();
    throw new InternalServerErrorException('Paraşüt entegrasyonu henüz uygulanmadı');
  }

  async getPdf(): Promise<GetPdfResult> {
    this.assertConfigured();
    throw new InternalServerErrorException('Paraşüt entegrasyonu henüz uygulanmadı');
  }
}
