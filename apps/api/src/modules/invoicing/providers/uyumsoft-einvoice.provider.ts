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
 * Uyumsoft e-Arsiv/e-Fatura adapter skeleton. Real HTTP calls are not
 * implemented; every method throws a clear configuration error, and the
 * request shapes below document the integration for a follow-up PR.
 *
 * TODO(W8-follow-up): implement the real Uyumsoft Entegrator SOAP API.
 *   - Auth: UYUMSOFT_USERNAME / UYUMSOFT_PASSWORD as WS-Security headers.
 *   - issue: SendDocument(UBL-TR XML, documentType: EARSIVFATURA | EFATURA) via IntegrationService.svc.
 *   - cancel: CancelEArchiveInvoice(uuid, reason), subject to the GIB cancellation window.
 *   - getStatus: GetEnvelopeStatus(uuid).
 *   - getPdf: GetDocumentData(uuid, format: PDF) (base64 PDF in the SOAP response).
 */
@Injectable()
export class UyumsoftEInvoiceProvider implements EInvoiceProviderAdapter {
  readonly name = EInvoiceProvider.UYUMSOFT;

  constructor(private readonly config: ConfigService) {}

  private assertConfigured(): void {
    const username = this.config.get<string>('UYUMSOFT_USERNAME');
    const password = this.config.get<string>('UYUMSOFT_PASSWORD');
    if (!username || !password) {
      throw new InternalServerErrorException(
        'Uyumsoft e-fatura sağlayıcısı yapılandırılmamış: UYUMSOFT_USERNAME ve UYUMSOFT_PASSWORD gereklidir',
      );
    }
  }

  async issue(_params: IssueInvoiceParams): Promise<EInvoiceIssueResult> {
    this.assertConfigured();
    throw new InternalServerErrorException('Uyumsoft entegrasyonu henüz uygulanmadı');
  }

  async cancel(_params: CancelInvoiceParams): Promise<EInvoiceCancelResult> {
    this.assertConfigured();
    throw new InternalServerErrorException('Uyumsoft entegrasyonu henüz uygulanmadı');
  }

  async getStatus(): Promise<{ status: string }> {
    this.assertConfigured();
    throw new InternalServerErrorException('Uyumsoft entegrasyonu henüz uygulanmadı');
  }

  async getPdf(): Promise<GetPdfResult> {
    this.assertConfigured();
    throw new InternalServerErrorException('Uyumsoft entegrasyonu henüz uygulanmadı');
  }
}
