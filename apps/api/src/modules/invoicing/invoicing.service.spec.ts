import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EInvoiceMode, EInvoiceProvider, InvoiceStatus, PaymentStatus, Prisma } from '@platform/database';
import { InvoicingService, splitVat } from './invoicing.service';
import { PrismaService } from '../prisma/prisma.service';
import { EInvoiceProviderRegistry } from './providers/einvoice-provider.registry';
import type { TenantContext } from '../auth/tenant-context';

describe('splitVat', () => {
  it('splits a VAT-inclusive total at 20% with half-up rounding', () => {
    const { net, vat } = splitVat(1000, 20);
    expect(net.toFixed(2)).toBe('833.33');
    expect(vat.toFixed(2)).toBe('166.67');
    expect(net.plus(vat).toFixed(2)).toBe('1000.00');
  });

  it('splits a VAT-inclusive total at 10%', () => {
    const { net, vat } = splitVat(550, 10);
    expect(net.toFixed(2)).toBe('500.00');
    expect(vat.toFixed(2)).toBe('50.00');
  });

  it('rounds half up, not to even', () => {
    // 100 / 1.08 = 92.592...  -> net rounds to 92.59
    const { net, vat } = splitVat(100, 8);
    expect(net.toFixed(2)).toBe('92.59');
    expect(vat.toFixed(2)).toBe('7.41');
  });
});

describe('InvoicingService - issueForPayment idempotency and number sequencing', () => {
  let service: InvoicingService;
  let prisma: any;
  let providers: any;
  let issue: jest.Mock;

  const tenant: TenantContext = {
    studioId: 'studio-1',
    membershipId: 'm-1',
    isOwner: true,
    isSuperAdmin: false,
    permissions: new Set(['finance.manage']),
    memberProfileId: null,
    trainerProfileId: null,
    branchIds: null,
  };

  const settings = {
    studioId: 'studio-1',
    legalName: 'Zen Reformer Pilates',
    taxOffice: 'Kadikoy',
    taxNumber: '1234567890',
    address: 'Istanbul',
    eInvoiceMode: EInvoiceMode.EARSIV,
    provider: EInvoiceProvider.MOCK,
    defaultVatRate: new Prisma.Decimal(20),
    seriesPrefix: 'A',
    autoIssueOnPayment: true,
  };

  const basePayment = {
    id: 'payment-1',
    studioId: 'studio-1',
    branchId: null,
    memberId: 'member-1',
    amount: new Prisma.Decimal('1000.00'),
    currency: 'TRY',
    paymentStatus: PaymentStatus.COMPLETED,
    memberPackage: { packageDefinition: { name: '10 Seans' } },
    member: { membership: { user: { firstName: 'Ada', lastName: 'Yilmaz' } } },
  };

  beforeEach(() => {
    issue = jest.fn().mockResolvedValue({ success: true, providerUuid: 'uuid-1', providerStatus: 'ISSUED' });
    prisma = {
      payment: { findFirst: jest.fn().mockResolvedValue(basePayment) },
      invoiceSettings: { findUnique: jest.fn().mockResolvedValue(settings) },
      invoice: {
        findUnique: jest.fn().mockResolvedValue(null),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
      billingProfile: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (fn: any) =>
        fn({
          invoiceCounter: {
            upsert: jest.fn().mockResolvedValue({ studioId: 'studio-1', seriesPrefix: 'A', year: 2026, lastSequence: 1 }),
          },
          invoice: {
            create: jest.fn().mockImplementation(({ data }: any) => ({ id: 'invoice-1', ...data })),
          },
        }),
      ),
    };
    providers = { get: jest.fn().mockReturnValue({ issue }) };
    service = new InvoicingService(prisma as unknown as PrismaService, providers as unknown as EInvoiceProviderRegistry);
  });

  it('creates and issues an invoice with a sequenced number', async () => {
    prisma.invoice.update.mockImplementation(({ data }: any) => ({ id: 'invoice-1', number: 'A2026000001', ...data }));
    const result = await service.issueForPayment('studio-1', 'payment-1');
    expect(issue).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(InvoiceStatus.ISSUED);
    expect(result.number).toBe('A2026000001');
  });

  it('is idempotent: an already-ISSUED invoice is returned without calling the provider again', async () => {
    prisma.invoice.findUnique.mockResolvedValue({ id: 'invoice-1', status: InvoiceStatus.ISSUED, paymentId: 'payment-1' });
    const result = await service.issueForPayment('studio-1', 'payment-1');
    expect(issue).not.toHaveBeenCalled();
    expect(result.status).toBe(InvoiceStatus.ISSUED);
  });

  it('retries a FAILED invoice by calling the provider again on the same row', async () => {
    prisma.invoice.findUnique.mockResolvedValue({ id: 'invoice-1', number: 'A2026000001', status: InvoiceStatus.FAILED, paymentId: 'payment-1' });
    prisma.invoice.update.mockImplementation(({ data }: any) => ({ id: 'invoice-1', number: 'A2026000001', ...data }));
    const result = await service.issueForPayment('studio-1', 'payment-1');
    expect(issue).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(InvoiceStatus.ISSUED);
  });

  it('marks the invoice FAILED (never throws) when the provider rejects it', async () => {
    prisma.invoice.update.mockImplementation(({ data }: any) => ({ id: 'invoice-1', ...data }));
    issue.mockResolvedValue({ success: false, failureMessage: 'sağlayıcı reddetti' });
    const result = await service.issueForPayment('studio-1', 'payment-1');
    expect(result.status).toBe(InvoiceStatus.FAILED);
    expect(result.failureReason).toBe('sağlayıcı reddetti');
  });

  it('rejects issuing for a payment that is not COMPLETED', async () => {
    prisma.payment.findFirst.mockResolvedValue({ ...basePayment, paymentStatus: PaymentStatus.PENDING });
    await expect(service.issueForPayment('studio-1', 'payment-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects issuing when the studio has no invoice settings', async () => {
    prisma.invoiceSettings.findUnique.mockResolvedValue(null);
    await expect(service.issueForPayment('studio-1', 'payment-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects issuing for an unknown payment', async () => {
    prisma.payment.findFirst.mockResolvedValue(null);
    await expect(service.issueForPayment('studio-1', 'payment-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
