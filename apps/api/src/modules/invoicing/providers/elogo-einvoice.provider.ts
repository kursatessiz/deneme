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
 * Logo/eLogo e-Arsiv/e-Fatura adapter skeleton. Real HTTP calls are not
 * implemented; every method throws a clear configuration error, and the
 * request shapes below document the integration for a follow-up PR.
 *
 * TODO(W8-follow-up): implement the real eLogo Connect API.
 *   - Bearer token from POST https://connect.elogo.com.tr/api/Token/Login
 *     using ELOGO_USERNAME / ELOGO_PASSWORD.
 *   - issue: POST /api/{EArchiveDocument|EInvoice}/Send with a UBL-TR XML payload
 *     built from seller/buyer identity, lines and VAT breakdown.
 *   - cancel: POST /api/EArchiveDocument/Cancel { documentUuid, reason }, subject to the GIB cancellation window.
 *   - getStatus: GET /api/EArchiveDocument/GetStatus/{documentUuid}.
 *   - getPdf: GET /api/EArchiveDocument/GetPdf/{documentUuid} (base64 PDF).
 */
@Injectable()
export class ElogoEInvoiceProvider implements EInvoiceProviderAdapter {
  readonly name = EInvoiceProvider.ELOGO;

  constructor(private readonly config: ConfigService) {}

  private assertConfigured(): void {
    const username = this.config.get<string>('ELOGO_USERNAME');
    const password = this.config.get<string>('ELOGO_PASSWORD');
    if (!username || !password) {
      throw new InternalServerErrorException(
        'Logo/eLogo e-fatura sağlayıcısı yapılandırılmamış: ELOGO_USERNAME ve ELOGO_PASSWORD gereklidir',
      );
    }
  }

  async issue(_params: IssueInvoiceParams): Promise<EInvoiceIssueResult> {
    this.assertConfigured();
    throw new InternalServerErrorException('Logo/eLogo entegrasyonu henüz uygulanmadı');
  }

  async cancel(_params: CancelInvoiceParams): Promise<EInvoiceCancelResult> {
    this.assertConfigured();
    throw new InternalServerErrorException('Logo/eLogo entegrasyonu henüz uygulanmadı');
  }

  async getStatus(): Promise<{ status: string }> {
    this.assertConfigured();
    throw new InternalServerErrorException('Logo/eLogo entegrasyonu henüz uygulanmadı');
  }

  async getPdf(): Promise<GetPdfResult> {
    this.assertConfigured();
    throw new InternalServerErrorException('Logo/eLogo entegrasyonu henüz uygulanmadı');
  }
}
