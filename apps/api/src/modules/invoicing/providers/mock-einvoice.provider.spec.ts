import { MockEInvoiceProvider } from './mock-einvoice.provider';

describe('MockEInvoiceProvider', () => {
  it('derives a deterministic UUID-shaped id from the invoice id', () => {
    const a = MockEInvoiceProvider.deriveUuid('invoice-abc');
    const b = MockEInvoiceProvider.deriveUuid('invoice-abc');
    const c = MockEInvoiceProvider.deriveUuid('invoice-xyz');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('issue() returns success with the same derived id every time (idempotent retries)', async () => {
    const provider = new MockEInvoiceProvider();
    const first = await provider.issue({
      studioId: 's1',
      invoiceId: 'invoice-1',
      number: 'A2026000001',
      issueDate: new Date(),
      seller: { legalName: 'Test Studio' },
      buyer: { kind: 'INDIVIDUAL', fullName: 'Ada Yilmaz', tckn: '11111111111' },
      lines: [],
      subtotal: 833.33,
      vatAmount: 166.67,
      vatRate: 20,
      total: 1000,
      currency: 'TRY',
    });
    const second = await provider.issue({
      studioId: 's1',
      invoiceId: 'invoice-1',
      number: 'A2026000001',
      issueDate: new Date(),
      seller: { legalName: 'Test Studio' },
      buyer: { kind: 'INDIVIDUAL', fullName: 'Ada Yilmaz', tckn: '11111111111' },
      lines: [],
      subtotal: 833.33,
      vatAmount: 166.67,
      vatRate: 20,
      total: 1000,
      currency: 'TRY',
    });
    expect(first.success).toBe(true);
    expect(first.providerUuid).toBe(second.providerUuid);
  });

  it('getPdf() returns HTML content with the correct content type', async () => {
    const provider = new MockEInvoiceProvider();
    const file = await provider.getPdf('s1', 'uuid-1');
    expect(file.contentType).toContain('text/html');
    expect(file.body.toString('utf-8')).toContain('uuid-1');
  });
});
