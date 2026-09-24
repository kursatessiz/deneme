import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { EInvoiceProvider } from '@platform/database';
import type { EInvoiceCancelResult, EInvoiceIssueResult } from '@platform/shared';
import type {
  CancelInvoiceParams,
  EInvoiceProviderAdapter,
  GetPdfResult,
  IssueInvoiceParams,
} from './einvoice-provider.interface';

/**
 * Deterministic in-process e-invoice provider used by default and in tests.
 * No network calls: issue() derives a stable UUID-shaped id from the
 * invoice id (so retries and re-reads are idempotent) and renders a simple
 * HTML document as a stand-in for the PDF a real integrator would return.
 */
@Injectable()
export class MockEInvoiceProvider implements EInvoiceProviderAdapter {
  readonly name = EInvoiceProvider.MOCK;

  async issue(params: IssueInvoiceParams): Promise<EInvoiceIssueResult> {
    const uuid = MockEInvoiceProvider.deriveUuid(params.invoiceId);
    return {
      success: true,
      providerUuid: uuid,
      providerStatus: 'ISSUED',
      pdfUrl: undefined, // MOCK renders the HTML placeholder on demand instead of storing a URL.
    };
  }

  async cancel(_params: CancelInvoiceParams): Promise<EInvoiceCancelResult> {
    return { success: true };
  }

  async getStatus(_studioId: string, _providerUuid: string): Promise<{ status: string }> {
    return { status: 'ISSUED' };
  }

  async getPdf(_studioId: string, providerUuid: string): Promise<GetPdfResult> {
    const html = MockEInvoiceProvider.renderHtml(providerUuid);
    return { contentType: 'text/html; charset=utf-8', body: Buffer.from(html, 'utf-8') };
  }

  /** Deterministic UUID-shaped id derived from our own invoice id, so re-issuing the same invoice is a no-op. */
  static deriveUuid(invoiceId: string): string {
    const hash = createHash('sha256').update(`mock-einvoice:${invoiceId}`).digest('hex');
    return [hash.slice(0, 8), hash.slice(8, 12), '4' + hash.slice(13, 16), '8' + hash.slice(17, 20), hash.slice(20, 32)].join(
      '-',
    );
  }

  /** Placeholder invoice document. Real adapters return the integrator's actual PDF bytes. */
  static renderHtml(providerUuid: string): string {
    return `<!doctype html>
<html lang="tr">
<head><meta charset="utf-8"><title>e-Arşiv Fatura (MOCK) ${providerUuid}</title></head>
<body>
<h1>e-Arşiv Fatura - MOCK</h1>
<p>Bu belge gerçek bir yasal fatura değildir; yalnızca geliştirme/test için üretilmiş bir yer tutucudur.</p>
<p>Sağlayıcı referansı: ${providerUuid}</p>
</body>
</html>`;
  }
}
