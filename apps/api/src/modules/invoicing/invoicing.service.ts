import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  EInvoiceMode,
  EInvoiceProvider,
  Invoice,
  InvoiceStatus,
  PaymentStatus,
  Prisma,
} from '@platform/database';
import type {
  BillingProfileInput,
  CancelInvoiceInput,
  InvoiceSettingsInput,
  ListInvoicesQuery,
} from '@platform/shared';
import { BASE_MESSAGES, BUNDLED_MESSAGES, EARSIV_GENERIC_CONSUMER_TCKN, createTranslator } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../auth/tenant-context';
import { assertBranchAccess, branchScope } from '../branches/branch-access';
import { EInvoiceProviderRegistry } from './providers/einvoice-provider.registry';
import type { InvoiceBuyer, InvoiceLine } from './providers/einvoice-provider.interface';
import { apiError } from '../../common/api-error';

type Tx = Prisma.TransactionClient;

/** VAT-inclusive price split: net = total / (1 + rate), rounded half-up to 2 decimals; vat = total - net. */
export function splitVat(total: Prisma.Decimal | number, vatRatePercent: Prisma.Decimal | number) {
  const totalD = new Prisma.Decimal(total);
  const rate = new Prisma.Decimal(vatRatePercent).dividedBy(100);
  const net = totalD.dividedBy(rate.plus(1)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const vat = totalD.minus(net);
  return { net, vat };
}

@Injectable()
export class InvoicingService {
  private readonly logger = new Logger(InvoicingService.name);

  constructor(
    private prisma: PrismaService,
    private providers: EInvoiceProviderRegistry,
  ) {}

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  async getSettings(studioId: string) {
    const settings = await this.prisma.invoiceSettings.findUnique({ where: { studioId } });
    return settings ?? null;
  }

  async upsertSettings(tenant: TenantContext, actorUserId: string, dto: InvoiceSettingsInput) {
    const studioId = tenant.studioId;
    const settings = await this.prisma.invoiceSettings.upsert({
      where: { studioId },
      create: { studioId, ...dto },
      update: { ...dto },
    });
    await this.prisma.auditLog.create({
      data: { studioId, userId: actorUserId, action: 'invoicing.settings.update', entityType: 'InvoiceSettings', entityId: settings.id },
    });
    return settings;
  }

  // ---------------------------------------------------------------------------
  // Billing profiles
  // ---------------------------------------------------------------------------

  async getBillingProfile(tenant: TenantContext, memberId: string) {
    const member = await this.prisma.memberProfile.findFirst({ where: { id: memberId, studioId: tenant.studioId } });
    if (!member) throw new NotFoundException(apiError('apiErrors.common.memberNotFound'));
    return this.prisma.billingProfile.findUnique({ where: { memberId } });
  }

  async upsertBillingProfile(tenant: TenantContext, memberId: string, dto: BillingProfileInput) {
    const studioId = tenant.studioId;
    const member = await this.prisma.memberProfile.findFirst({ where: { id: memberId, studioId } });
    if (!member) throw new NotFoundException(apiError('apiErrors.common.memberNotFound'));
    return this.prisma.billingProfile.upsert({
      where: { memberId },
      create: { studioId, memberId, ...dto },
      update: { ...dto },
    });
  }

  async getMyBillingProfile(tenant: TenantContext) {
    if (!tenant.memberProfileId) throw new ForbiddenException(apiError('apiErrors.common.actionOnlyMembers'));
    return this.prisma.billingProfile.findUnique({ where: { memberId: tenant.memberProfileId } });
  }

  async upsertMyBillingProfile(tenant: TenantContext, dto: BillingProfileInput) {
    if (!tenant.memberProfileId) throw new ForbiddenException(apiError('apiErrors.common.actionOnlyMembers'));
    return this.upsertBillingProfile(tenant, tenant.memberProfileId, dto);
  }

  // ---------------------------------------------------------------------------
  // Number sequencing
  // ---------------------------------------------------------------------------

  /** Atomically reserves the next sequence for studio+series+year and formats the invoice number. */
  private async nextNumber(tx: Tx, studioId: string, seriesPrefix: string, year: number): Promise<string> {
    const counter = await tx.invoiceCounter.upsert({
      where: { studioId_seriesPrefix_year: { studioId, seriesPrefix, year } },
      create: { studioId, seriesPrefix, year, lastSequence: 1 },
      update: { lastSequence: { increment: 1 } },
    });
    return `${seriesPrefix}${year}${String(counter.lastSequence).padStart(6, '0')}`;
  }

  // ---------------------------------------------------------------------------
  // Issue on payment completion (idempotent by paymentId)
  // ---------------------------------------------------------------------------

  /**
   * Creates and issues the invoice for a completed payment. Idempotent: a
   * payment already carrying an ISSUED or CANCELLED invoice is returned
   * unchanged; a FAILED one is retried in place (same number). Never throws
   * for a provider failure: the invoice is left FAILED with a reason and
   * the caller (payments service or the retry endpoint) can proceed either
   * way. Structural problems (unknown payment, wrong studio, mode NONE)
   * still throw, since those indicate a programming or configuration error.
   */
  async issueForPayment(studioId: string, paymentId: string): Promise<Invoice> {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, studioId },
      include: {
        memberPackage: { include: { packageDefinition: true } },
        member: { include: { membership: { include: { user: true } } } },
        contact: { select: { firstName: true, lastName: true } },
        studio: { select: { defaultLocale: true } },
      },
    });
    if (!payment) throw new NotFoundException(apiError('apiErrors.common.paymentNotFound'));
    if (payment.paymentStatus !== PaymentStatus.COMPLETED) {
      throw new BadRequestException(apiError('apiErrors.invoicing.invoiceCanOnlyIssuedCompletedPayments'));
    }

    const settings = await this.prisma.invoiceSettings.findUnique({ where: { studioId } });
    if (!settings || settings.eInvoiceMode === EInvoiceMode.NONE) {
      throw new BadRequestException(apiError('apiErrors.invoicing.eInvoicingNotConfiguredBusiness'));
    }

    let invoice = await this.prisma.invoice.findUnique({ where: { paymentId } });
    if (invoice && invoice.status !== InvoiceStatus.FAILED) {
      return invoice; // ISSUED or CANCELLED: nothing to do, already resolved.
    }

    // A guest or walk-in payment has no member and so no billing profile: the
    // buyer is the CRM contact when known, otherwise the translated walk-in label.
    const billingProfile = payment.memberId ? await this.prisma.billingProfile.findUnique({ where: { memberId: payment.memberId } }) : null;
    const buyer = this.buildBuyer(billingProfile, payment.member?.membership.user ?? payment.contact ?? this.walkInBuyer(payment.studio.defaultLocale));

    if (settings.eInvoiceMode === EInvoiceMode.EFATURA && !buyer.vkn) {
      const reason = 'e-Fatura için alıcının VKN bilgisi zorunludur; üye şirket fatura profili eksik';
      invoice = await this.persistDraftOrFail(invoice, studioId, payment, settings, buyer, reason);
      return invoice;
    }

    const { net, vat } = splitVat(payment.amount, settings.defaultVatRate);
    const description = payment.memberPackage?.packageDefinition?.name ?? 'Paket/hizmet ödemesi';
    const lines: InvoiceLine[] = [
      { description, quantity: 1, unitPrice: Number(payment.amount), total: Number(payment.amount) },
    ];

    if (!invoice) {
      const year = new Date().getFullYear();
      try {
        invoice = await this.prisma.$transaction(async (tx) => {
          const number = await this.nextNumber(tx, studioId, settings.seriesPrefix, year);
          return tx.invoice.create({
            data: {
              studioId,
              branchId: payment.branchId,
              paymentId: payment.id,
              number,
              issueDate: new Date(),
              buyerSnapshot: buyer as unknown as Prisma.InputJsonValue,
              lines: lines as unknown as Prisma.InputJsonValue,
              subtotal: net,
              vatAmount: vat,
              total: payment.amount,
              currency: payment.currency,
              status: InvoiceStatus.DRAFT,
              provider: settings.provider,
            },
          });
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          // Concurrent issue attempt already created it; use that row.
          invoice = await this.prisma.invoice.findUniqueOrThrow({ where: { paymentId } });
        } else {
          throw err;
        }
      }
    }

    const adapter = this.providers.get(settings.provider);
    try {
      const result = await adapter.issue({
        studioId,
        invoiceId: invoice.id,
        number: invoice.number,
        issueDate: invoice.issueDate,
        seller: { legalName: settings.legalName, taxOffice: settings.taxOffice ?? undefined, taxNumber: settings.taxNumber ?? undefined, address: settings.address ?? undefined },
        buyer,
        lines,
        subtotal: Number(net),
        vatAmount: Number(vat),
        vatRate: Number(settings.defaultVatRate),
        total: Number(payment.amount),
        currency: payment.currency,
      });
      if (!result.success) {
        return this.markFailed(invoice.id, result.failureMessage ?? 'Sağlayıcı faturayı reddetti');
      }
      return this.prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: InvoiceStatus.ISSUED,
          provider: settings.provider, // a retry may run against a provider changed since the failed attempt
          providerUuid: result.providerUuid,
          providerStatus: result.providerStatus,
          pdfUrl: result.pdfUrl,
          failureReason: null,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bilinmeyen hata';
      this.logger.warn(`e-invoice issue failed for payment ${payment.id}: ${message}`);
      return this.markFailed(invoice.id, message);
    }
  }

  /** Retry endpoint: re-attempts issuing a FAILED invoice, or is a no-op for one already resolved. */
  async retry(tenant: TenantContext, invoiceId: string): Promise<Invoice> {
    const invoice = await this.prisma.invoice.findFirst({ where: { id: invoiceId, studioId: tenant.studioId } });
    if (!invoice) throw new NotFoundException(apiError('apiErrors.invoicing.invoiceNotFound'));
    if (invoice.branchId) assertBranchAccess(tenant, invoice.branchId);
    if (invoice.status !== InvoiceStatus.FAILED) {
      throw new BadRequestException(apiError('apiErrors.invoicing.onlyFailedInvoicesCanRetried'));
    }
    return this.issueForPayment(tenant.studioId, invoice.paymentId);
  }

  private async markFailed(invoiceId: string, reason: string): Promise<Invoice> {
    return this.prisma.invoice.update({ where: { id: invoiceId }, data: { status: InvoiceStatus.FAILED, failureReason: reason } });
  }

  /** Structural failure before a provider call was even attempted (e.g. missing VKN for e-Fatura). */
  private async persistDraftOrFail(
    existing: Invoice | null,
    studioId: string,
    payment: { id: string; branchId: string | null; amount: Prisma.Decimal; currency: string },
    settings: { seriesPrefix: string; defaultVatRate: Prisma.Decimal; provider: EInvoiceProvider },
    buyer: InvoiceBuyer,
    reason: string,
  ): Promise<Invoice> {
    if (existing) return this.markFailed(existing.id, reason);
    const { net, vat } = splitVat(payment.amount, settings.defaultVatRate);
    const year = new Date().getFullYear();
    return this.prisma.$transaction(async (tx) => {
      const number = await this.nextNumber(tx, studioId, settings.seriesPrefix, year);
      return tx.invoice.create({
        data: {
          studioId,
          branchId: payment.branchId,
          paymentId: payment.id,
          number,
          issueDate: new Date(),
          buyerSnapshot: buyer as unknown as Prisma.InputJsonValue,
          lines: [] as unknown as Prisma.InputJsonValue,
          subtotal: net,
          vatAmount: vat,
          total: payment.amount,
          currency: payment.currency,
          status: InvoiceStatus.FAILED,
          provider: settings.provider,
          failureReason: reason,
        },
      });
    });
  }

  /** Name of an anonymous walk-in buyer, in the studio language (bundled catalogue). */
  private walkInBuyer(locale: string): { firstName: string; lastName: string } {
    const messages = BUNDLED_MESSAGES[locale] ?? BUNDLED_MESSAGES[locale.split('-')[0]] ?? BASE_MESSAGES;
    const t = createTranslator({ locale, messages, fallback: BASE_MESSAGES });
    return { firstName: t('finance.payments.walkIn'), lastName: '' };
  }

  private buildBuyer(
    billingProfile: { kind: string; fullName: string | null; tckn: string | null; companyTitle: string | null; vkn: string | null; taxOffice: string | null; address: string | null; email: string | null } | null,
    user: { firstName: string; lastName: string },
  ): InvoiceBuyer {
    if (billingProfile?.kind === 'COMPANY') {
      return {
        kind: 'COMPANY',
        companyTitle: billingProfile.companyTitle ?? undefined,
        vkn: billingProfile.vkn ?? undefined,
        taxOffice: billingProfile.taxOffice ?? undefined,
        address: billingProfile.address ?? undefined,
        email: billingProfile.email ?? undefined,
      };
    }
    return {
      kind: 'INDIVIDUAL',
      fullName: billingProfile?.fullName ?? `${user.firstName} ${user.lastName}`.trim(),
      // No TCKN on file: e-Arsiv's standard generic-consumer identity number (documented in docs/INVOICING.md).
      tckn: billingProfile?.tckn ?? EARSIV_GENERIC_CONSUMER_TCKN,
      address: billingProfile?.address ?? undefined,
      email: billingProfile?.email ?? undefined,
    };
  }

  // ---------------------------------------------------------------------------
  // Listing, retrieval, cancel, download
  // ---------------------------------------------------------------------------

  async list(tenant: TenantContext, query: ListInvoicesQuery) {
    const scope = branchScope(tenant, query.branchId);
    return this.prisma.invoice.findMany({
      where: {
        studioId: tenant.studioId,
        ...scope,
        ...(query.from || query.to ? { issueDate: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { issueDate: 'desc' },
    });
  }

  async getOne(tenant: TenantContext, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({ where: { id: invoiceId, studioId: tenant.studioId } });
    if (!invoice) throw new NotFoundException(apiError('apiErrors.invoicing.invoiceNotFound'));
    if (invoice.branchId) assertBranchAccess(tenant, invoice.branchId);
    return invoice;
  }

  async listMine(tenant: TenantContext) {
    if (!tenant.memberProfileId) throw new ForbiddenException(apiError('apiErrors.common.actionOnlyMembers'));
    return this.prisma.invoice.findMany({
      where: { studioId: tenant.studioId, payment: { memberId: tenant.memberProfileId } },
      orderBy: { issueDate: 'desc' },
    });
  }

  async getMine(tenant: TenantContext, invoiceId: string) {
    if (!tenant.memberProfileId) throw new ForbiddenException(apiError('apiErrors.common.actionOnlyMembers'));
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, studioId: tenant.studioId, payment: { memberId: tenant.memberProfileId } },
    });
    if (!invoice) throw new NotFoundException(apiError('apiErrors.invoicing.invoiceNotFound'));
    return invoice;
  }

  /**
   * Cancels an invoice. A full refund already reached here from the
   * payments service; documented GIB e-Arsiv rule: cancellation is only
   * possible until the end of the day the invoice was issued (T+0, until
   * midnight). Beyond that window the invoice stands and a credit/"iade
   * faturası" must be issued instead - not implemented yet, tracked below.
   *
   * TODO(W8-follow-up): implement "iade faturası" (credit note) issuance
   * for cancellations requested after the GIB same-day window, and for
   * partial refunds (which never cancel the original invoice - see
   * docs/INVOICING.md for the reconciliation note recorded today).
   */
  async cancel(tenant: TenantContext, actorUserId: string, invoiceId: string, dto: CancelInvoiceInput) {
    const invoice = await this.getOne(tenant, invoiceId);
    if (invoice.status !== InvoiceStatus.ISSUED) {
      throw new BadRequestException(apiError('apiErrors.invoicing.onlyIssuedInvoicesCanCancelled'));
    }
    const sameDay = isSameCalendarDay(invoice.issueDate, new Date());
    if (!sameDay) {
      this.logger.warn(
        `Invoice ${invoice.id} cancelled outside the GIB same-day e-Arsiv window; a credit note ("iade faturasi") should be issued instead (not yet implemented).`,
      );
    }

    if (invoice.providerUuid) {
      const adapter = this.providers.get(invoice.provider);
      try {
        const result = await adapter.cancel({ studioId: tenant.studioId, providerUuid: invoice.providerUuid, reason: dto.reason });
        if (!result.success) {
          throw new BadRequestException(result.failureMessage ?? apiError('apiErrors.invoicing.providerRejectedCancellation'));
        }
      } catch (err) {
        if (err instanceof BadRequestException) throw err;
        throw new BadRequestException(err instanceof Error ? err.message : apiError('apiErrors.invoicing.cancellationFailed'));
      }
    }

    const updated = await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: InvoiceStatus.CANCELLED, cancelledAt: new Date(), cancelReason: dto.reason },
    });
    await this.prisma.auditLog.create({
      data: { studioId: tenant.studioId, userId: actorUserId, action: 'invoicing.invoice.cancel', entityType: 'Invoice', entityId: invoice.id, metadata: { reason: dto.reason, sameDay } },
    });
    return updated;
  }

  /**
   * Best-effort cancel used by a full refund: no-op when the payment never
   * had an invoice, or when it is not currently ISSUED (already cancelled,
   * still a draft, or failed). Called from PaymentsService inside a
   * try/catch, so an invoice-cancellation problem never blocks the refund.
   */
  async cancelForRefund(tenant: TenantContext, actorUserId: string, paymentId: string, reason: string): Promise<Invoice | null> {
    const invoice = await this.prisma.invoice.findUnique({ where: { paymentId } });
    if (!invoice || invoice.studioId !== tenant.studioId || invoice.status !== InvoiceStatus.ISSUED) return null;
    return this.cancel(tenant, actorUserId, invoice.id, { reason });
  }

  async downloadPdf(tenant: TenantContext, invoiceId: string, self: boolean) {
    const invoice = self ? await this.getMine(tenant, invoiceId) : await this.getOne(tenant, invoiceId);
    if (invoice.status !== InvoiceStatus.ISSUED || !invoice.providerUuid) {
      throw new ConflictException(apiError('apiErrors.invoicing.invoiceNotIssuedYet'));
    }
    const adapter = this.providers.get(invoice.provider);
    return adapter.getPdf(tenant.studioId, invoice.providerUuid);
  }

  async exportCsv(tenant: TenantContext, query: ListInvoicesQuery) {
    return this.list(tenant, query);
  }
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}
