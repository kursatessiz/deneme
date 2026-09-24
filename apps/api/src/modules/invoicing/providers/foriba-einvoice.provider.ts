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
 * Foriba/Sovos e-Arsiv/e-Fatura adapter skeleton. Real HTTP calls are not
 * implemented; every method throws a clear configuration error, and the
 * request shapes below document the integration for a follow-up PR.
 *
 * TODO(W8-follow-up): implement the real Foriba (Sovos) SOAP/REST API.
 *   - Auth: FORIBA_USERNAME / FORIBA_PASSWORD passed as WS-Security headers (SOAP) or basic auth (REST gateway).
 *   - issue: SendInvoice(UBL-TR XML) via the EFaturaWS/EArsivWS endpoint, one call per document.
 *   - cancel: CancelEArchiveInvoice(uuid, reason), subject to the GIB cancellation window.
 *   - getStatus: GetInvoiceStatus(uuid).
 *   - getPdf: GetInvoicePDF(uuid) (base64 PDF in the SOAP response).
 */
@Injectable()
export class ForibaEInvoiceProvider implements EInvoiceProviderAdapter {
  readonly name = EInvoiceProvider.FORIBA;

  constructor(private readonly config: ConfigService) {}

  private assertConfigured(): void {
    const username = this.config.get<string>('FORIBA_USERNAME');
    const password = this.config.get<string>('FORIBA_PASSWORD');
    if (!username || !password) {
      throw new InternalServerErrorException(
        'Foriba/Sovos e-fatura sağlayıcısı yapılandırılmamış: FORIBA_USERNAME ve FORIBA_PASSWORD gereklidir',
      );
    }
  }

  async issue(_params: IssueInvoiceParams): Promise<EInvoiceIssueResult> {
    this.assertConfigured();
    throw new InternalServerErrorException('Foriba/Sovos entegrasyonu henüz uygulanmadı');
  }

  async cancel(_params: CancelInvoiceParams): Promise<EInvoiceCancelResult> {
    this.assertConfigured();
    throw new InternalServerErrorException('Foriba/Sovos entegrasyonu henüz uygulanmadı');
  }

  async getStatus(): Promise<{ status: string }> {
    this.assertConfigured();
    throw new InternalServerErrorException('Foriba/Sovos entegrasyonu henüz uygulanmadı');
  }

  async getPdf(): Promise<GetPdfResult> {
    this.assertConfigured();
    throw new InternalServerErrorException('Foriba/Sovos entegrasyonu henüz uygulanmadı');
  }
}
