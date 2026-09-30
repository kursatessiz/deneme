import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@platform/database';
import type { AddOn, AddOnPrice } from '@platform/database';
import { ADD_ON_ERROR_CODES, PLATFORM_BILLING_CURRENCIES, addOnHasAccess, isPlatformBillingCurrency } from '@platform/shared';
import type {
  AddOnPriceDTO,
  AdminAddOnDTO,
  AdminAddOnRevenueDTO,
  CreateAddOnInput,
  LocalizedText,
  SetAddOnPricesInput,
  UpdateAddOnInput,
} from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';

type PricedAddOn = AddOn & { prices: AddOnPrice[] };

export function addOnError(code: (typeof ADD_ON_ERROR_CODES)[keyof typeof ADD_ON_ERROR_CODES], message: string, kind: 'bad' | 'conflict' | 'notFound'): Error {
  const body = { statusCode: kind === 'bad' ? 400 : kind === 'conflict' ? 409 : 404, code, message };
  if (kind === 'bad') return new BadRequestException(body);
  if (kind === 'conflict') return new ConflictException(body);
  return new NotFoundException(body);
}

/** JSON column back to per-locale text; anything that is not a string map becomes empty. */
export function toLocalizedText(value: Prisma.JsonValue): LocalizedText {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const out: LocalizedText = {};
  for (const [locale, text] of Object.entries(value)) {
    if (typeof text === 'string') out[locale] = text;
  }
  return out;
}

export function toStringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export function toPriceDtos(prices: readonly AddOnPrice[]): AddOnPriceDTO[] {
  return PLATFORM_BILLING_CURRENCIES.flatMap((currency) => {
    const price = prices.find((p) => p.currency === currency);
    return price ? [{ currency, priceMonthly: price.priceMonthly.toFixed(2), priceYearly: price.priceYearly.toFixed(2) }] : [];
  });
}

/**
 * Super admin side of the add-on marketplace catalogue (G5c-2). Catalogue
 * rows are platform data (no tenant); every change is audit logged with a
 * null studioId. An add-on can only be published while it has a price.
 */
@Injectable()
export class AdminAddOnsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(now = new Date()): Promise<AdminAddOnDTO[]> {
    const [rows, live] = await Promise.all([
      this.prisma.addOn.findMany({ orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }], include: { prices: true } }),
      this.prisma.studioAddOn.findMany({
        where: { status: { not: 'EXPIRED' } },
        select: { addOnId: true, status: true, trialEndsAt: true, currentPeriodEnd: true },
      }),
    ]);
    const counts = new Map<string, number>();
    for (const row of live) {
      if (addOnHasAccess(row, now)) counts.set(row.addOnId, (counts.get(row.addOnId) ?? 0) + 1);
    }
    return rows.map((row) => toAdminDto(row, counts.get(row.id) ?? 0));
  }

  async create(actorUserId: string, input: CreateAddOnInput): Promise<AdminAddOnDTO> {
    if (input.isPublished) throw addOnError(ADD_ON_ERROR_CODES.publishNeedsPrice, 'Yayınlamak için önce fiyat girilmelidir', 'bad');
    const exists = await this.prisma.addOn.findUnique({ where: { key: input.key }, select: { id: true } });
    if (exists) throw addOnError(ADD_ON_ERROR_CODES.keyExists, 'Bu anahtarla bir uygulama zaten var', 'conflict');
    const row = await this.prisma.addOn.create({
      data: {
        key: input.key,
        name: input.name,
        description: input.description,
        promoVideoUrl: input.promoVideoUrl,
        screenshotUrls: input.screenshotUrls,
        featureFlagKey: input.featureFlagKey,
        trialDays: input.trialDays,
        isPublished: false,
        sortOrder: input.sortOrder,
      },
      include: { prices: true },
    });
    await this.audit(actorUserId, 'add_on.create', row.id, { key: row.key, featureFlagKey: row.featureFlagKey, trialDays: row.trialDays });
    return toAdminDto(row, 0);
  }

  async update(actorUserId: string, id: string, input: UpdateAddOnInput): Promise<AdminAddOnDTO> {
    const existing = await this.prisma.addOn.findUnique({ where: { id }, include: { prices: true } });
    if (!existing) throw addOnError(ADD_ON_ERROR_CODES.notFound, 'Uygulama bulunamadı', 'notFound');
    if (input.isPublished === true && existing.prices.length === 0) {
      throw addOnError(ADD_ON_ERROR_CODES.publishNeedsPrice, 'Yayınlamak için en az bir para biriminde fiyat girilmelidir', 'bad');
    }
    const data: Prisma.AddOnUpdateInput = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.promoVideoUrl !== undefined ? { promoVideoUrl: input.promoVideoUrl } : {}),
      ...(input.screenshotUrls !== undefined ? { screenshotUrls: input.screenshotUrls } : {}),
      ...(input.featureFlagKey !== undefined ? { featureFlagKey: input.featureFlagKey } : {}),
      ...(input.trialDays !== undefined ? { trialDays: input.trialDays } : {}),
      ...(input.isPublished !== undefined ? { isPublished: input.isPublished } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    };
    const row = await this.prisma.addOn.update({ where: { id }, data, include: { prices: true } });
    await this.audit(actorUserId, 'add_on.update', id, {
      key: row.key,
      changed: Object.keys(input),
      isPublished: { from: existing.isPublished, to: row.isPublished },
      featureFlagKey: { from: existing.featureFlagKey, to: row.featureFlagKey },
    });
    return toAdminDto(row, await this.tenantCount(id));
  }

  /** Replaces the whole price set (a currency left out is removed). A published add-on must keep at least one price. */
  async setPrices(actorUserId: string, id: string, input: SetAddOnPricesInput): Promise<AdminAddOnDTO> {
    const existing = await this.prisma.addOn.findUnique({ where: { id }, include: { prices: true } });
    if (!existing) throw addOnError(ADD_ON_ERROR_CODES.notFound, 'Uygulama bulunamadı', 'notFound');
    if (existing.isPublished && input.prices.length === 0) {
      throw addOnError(ADD_ON_ERROR_CODES.publishNeedsPrice, 'Yayındaki uygulamanın en az bir fiyatı olmalıdır; önce yayından kaldırın', 'conflict');
    }
    for (const price of input.prices) {
      if (!isPlatformBillingCurrency(price.currency)) throw new BadRequestException('Geçersiz para birimi');
    }
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.addOnPrice.deleteMany({ where: { addOnId: id, currency: { notIn: input.prices.map((p) => p.currency) } } });
      for (const price of input.prices) {
        await tx.addOnPrice.upsert({
          where: { addOnId_currency: { addOnId: id, currency: price.currency } },
          create: { addOnId: id, currency: price.currency, priceMonthly: new Prisma.Decimal(price.priceMonthly), priceYearly: new Prisma.Decimal(price.priceYearly) },
          update: { priceMonthly: new Prisma.Decimal(price.priceMonthly), priceYearly: new Prisma.Decimal(price.priceYearly) },
        });
      }
      return tx.addOn.findUniqueOrThrow({ where: { id }, include: { prices: true } });
    });
    await this.audit(actorUserId, 'add_on.prices', id, {
      key: row.key,
      before: toPriceDtos(existing.prices).map((p) => ({ ...p })),
      after: toPriceDtos(row.prices).map((p) => ({ ...p })),
    });
    return toAdminDto(row, await this.tenantCount(id));
  }

  /** Completed add-on payments per currency; currencies are never summed together. */
  async revenue(): Promise<AdminAddOnRevenueDTO> {
    const groups = await this.prisma.platformBillingPayment.groupBy({
      by: ['currency'],
      where: { studioAddOnId: { not: null }, status: 'COMPLETED' },
      _sum: { amount: true },
      _count: { _all: true },
      orderBy: { currency: 'asc' },
    });
    return {
      items: groups.map((g) => ({ currency: g.currency, amount: (g._sum.amount ?? new Prisma.Decimal(0)).toFixed(2), payments: g._count._all })),
    };
  }

  private async tenantCount(addOnId: string, now = new Date()): Promise<number> {
    const rows = await this.prisma.studioAddOn.findMany({
      where: { addOnId, status: { not: 'EXPIRED' } },
      select: { status: true, trialEndsAt: true, currentPeriodEnd: true },
    });
    return rows.filter((row) => addOnHasAccess(row, now)).length;
  }

  private async audit(actorUserId: string, action: string, entityId: string, metadata: Prisma.InputJsonObject): Promise<void> {
    await this.prisma.auditLog.create({ data: { studioId: null, userId: actorUserId, action, entityType: 'AddOn', entityId, metadata } });
  }
}

export function toAdminDto(row: PricedAddOn, tenantCount: number): AdminAddOnDTO {
  return {
    id: row.id,
    key: row.key,
    name: toLocalizedText(row.name),
    description: toLocalizedText(row.description),
    promoVideoUrl: row.promoVideoUrl,
    screenshotUrls: toStringArray(row.screenshotUrls),
    featureFlagKey: row.featureFlagKey,
    trialDays: row.trialDays,
    isPublished: row.isPublished,
    sortOrder: row.sortOrder,
    prices: toPriceDtos(row.prices),
    tenantCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
