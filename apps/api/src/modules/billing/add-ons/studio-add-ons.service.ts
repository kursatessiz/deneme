import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@platform/database';
import type { AddOn, AddOnPrice, StudioAddOn } from '@platform/database';
import {
  ADD_ON_ERROR_CODES,
  FEATURE_FLAGS,
  addOnHasAccess,
  addOnPriceIn,
  buildAddOnSnapshot,
  isAddOnStatus,
  isWriteRestricted,
  parseAddOnSnapshot,
  studioBillingCurrency,
  trialDaysLeft,
  trialEndFrom,
} from '@platform/shared';
import type {
  ActivateAddOnInput,
  AddOnInterval,
  AddOnPriceDTO,
  AddOnStatus,
  AddOnTenantState,
  StudioAddOnActionResultDTO,
  StudioAddOnDTO,
  StudioAddOnListDTO,
  StudioFeaturesDTO,
} from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { billingRestrictedError } from '../../auth/guards/billing-write.guard';
import type { TenantContext } from '../../auth/tenant-context';
import { AddOnChargeService } from './add-on-charge.service';
import { addOnError, toLocalizedText, toPriceDtos, toStringArray } from './admin-add-ons.service';
import { resolveFeaturesForStudio } from './effective-feature';
import { apiError, codedError } from '../../../common/api-error';

type CatalogueRow = AddOn & { prices: AddOnPrice[]; studioAddOns: StudioAddOn[] };

const HOUR_MS = 60 * 60 * 1000;

/**
 * Tenant side of the add-on marketplace (G5c-2): the catalogue with the
 * tenant's own state and price in its billing currency, the one free trial
 * per add-on, activation through the platform billing path, cancellation
 * (access until the period end) and the effective features used by module-off
 * empty states. Owner only through billing.manage, except `features`.
 */
@Injectable()
export class StudioAddOnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly charges: AddOnChargeService,
    private readonly config: ConfigService,
  ) {}

  async list(studioId: string, now = new Date()): Promise<StudioAddOnListDTO> {
    const studio = await this.studio(studioId);
    const currency = studioBillingCurrency(studio);
    const rows = await this.prisma.addOn.findMany({
      where: { OR: [{ isPublished: true }, { studioAddOns: { some: { studioId } } }] },
      orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
      include: { prices: true, studioAddOns: { where: { studioId } } },
    });
    const base = (this.config.get<string>('PUBLIC_APP_URL') ?? 'http://localhost:3000').replace(/\/+$/, '');
    return {
      billingCurrency: currency,
      manageUrl: `${base}/ayarlar/uygulamalar`,
      items: rows.map((row) => toTenantDto(row, currency, now)),
    };
  }

  /** The one free trial of this add-on for this tenant. */
  async startTrial(tenant: TenantContext, actorUserId: string, key: string, now = new Date()): Promise<StudioAddOnActionResultDTO> {
    const studio = await this.assertCanBuy(tenant.studioId);
    const currency = studioBillingCurrency(studio);
    const addOn = await this.publishedAddOn(key);
    if (addOn.trialDays <= 0) {
      throw addOnError(ADD_ON_ERROR_CODES.trialUnavailable, 'bad');
    }
    const price = addOnPriceIn(toPriceDtos(addOn.prices), currency);
    if (!price) throw addOnError(ADD_ON_ERROR_CODES.priceUnavailable, 'bad');
    const existing = await this.prisma.studioAddOn.findUnique({ where: { studioId_addOnId: { studioId: tenant.studioId, addOnId: addOn.id } } });
    if (existing?.trialStartedAt) throw addOnError(ADD_ON_ERROR_CODES.trialUsed, 'conflict');

    const trialEndsAt = trialEndFrom(now, addOn.trialDays);
    const data = {
      status: 'TRIALING',
      billingInterval: null,
      trialStartedAt: now,
      trialEndsAt,
      currentPeriodEnd: null,
      cancelledAt: null,
      priceSnapshot: buildAddOnSnapshot(price, null) as unknown as Prisma.InputJsonObject,
      trialReminderSentAt: null,
    };
    try {
      if (existing) {
        // A failed first purchase left an EXPIRED placeholder without a trial: the trial is still unused.
        const moved = await this.prisma.studioAddOn.updateMany({ where: { id: existing.id, trialStartedAt: null }, data });
        if (moved.count === 0) throw addOnError(ADD_ON_ERROR_CODES.trialUsed, 'conflict');
      } else {
        await this.prisma.studioAddOn.create({ data: { studioId: tenant.studioId, addOnId: addOn.id, ...data } });
      }
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw addOnError(ADD_ON_ERROR_CODES.trialUsed, 'conflict');
      }
      throw err;
    }
    const row = await this.prisma.studioAddOn.findUniqueOrThrow({ where: { studioId_addOnId: { studioId: tenant.studioId, addOnId: addOn.id } } });
    await this.audit(tenant.studioId, actorUserId, 'add_on.trial_start', row.id, { key: addOn.key, trialEndsAt: trialEndsAt.toISOString(), currency });
    return { item: await this.itemFor(tenant.studioId, key, now), pending: false, checkoutUrl: null };
  }

  /**
   * Buy (or renew now, when a renewal charge is overdue): charge the
   * chosen interval's price in the billing currency through the platform
   * billing path. A trial converts to ACTIVE when the payment completes.
   */
  async activate(tenant: TenantContext, actorUserId: string, key: string, dto: ActivateAddOnInput, now = new Date()): Promise<StudioAddOnActionResultDTO> {
    const studio = await this.assertCanBuy(tenant.studioId);
    const currency = studioBillingCurrency(studio);
    const addOn = await this.prisma.addOn.findUnique({ where: { key }, include: { prices: true } });
    if (!addOn) throw addOnError(ADD_ON_ERROR_CODES.notFound, 'notFound');
    const existing = await this.prisma.studioAddOn.findUnique({ where: { studioId_addOnId: { studioId: tenant.studioId, addOnId: addOn.id } } });

    let interval: AddOnInterval = dto.interval;
    let amount: string;
    let chargeCurrency: string = currency;
    if (existing?.status === 'ACTIVE') {
      // Only an overdue renewal can be paid now, at the price the tenant was quoted.
      const overdue = existing.currentPeriodEnd !== null && existing.currentPeriodEnd <= now;
      const snapshot = parseAddOnSnapshot(existing.priceSnapshot);
      if (!overdue || !snapshot || snapshot.amount === null || snapshot.interval === null) {
        throw addOnError(ADD_ON_ERROR_CODES.alreadyActive, 'conflict');
      }
      interval = snapshot.interval;
      amount = snapshot.amount;
      chargeCurrency = snapshot.currency;
    } else {
      if (!addOn.isPublished) throw addOnError(ADD_ON_ERROR_CODES.notFound, 'notFound');
      const price = addOnPriceIn(toPriceDtos(addOn.prices), currency);
      if (!price) throw addOnError(ADD_ON_ERROR_CODES.priceUnavailable, 'bad');
      amount = interval === 'YEAR' ? price.priceYearly : price.priceMonthly;
    }

    if (existing) {
      const pending = await this.prisma.platformBillingPayment.findFirst({
        where: { studioAddOnId: existing.id, status: 'PENDING', createdAt: { gte: new Date(now.getTime() - HOUR_MS) } },
        select: { id: true },
      });
      if (pending) throw addOnError(ADD_ON_ERROR_CODES.paymentPending, 'conflict');
    }
    let row: StudioAddOn;
    if (existing?.status === 'ACTIVE') {
      row = existing;
    } else {
      const price = addOnPriceIn(toPriceDtos(addOn.prices), currency);
      const snapshot = price ? (buildAddOnSnapshot(price, interval) as unknown as Prisma.InputJsonObject) : undefined;
      if (existing) {
        row = await this.prisma.studioAddOn.update({ where: { id: existing.id }, data: { priceSnapshot: snapshot } });
      } else {
        // Bought without a trial: an EXPIRED placeholder until the payment completes.
        row = await this.prisma.studioAddOn.create({
          data: { studioId: tenant.studioId, addOnId: addOn.id, status: 'EXPIRED', priceSnapshot: snapshot },
        });
      }
    }

    const result = await this.charges.charge(
      { studioAddOnId: row.id, studioId: tenant.studioId, addOnKey: key, currency: chargeCurrency, amount, interval, actorUserId },
      now,
    );
    if (result.status === 'FAILED') throw result.error instanceof Error ? result.error : new BadRequestException(apiError('apiErrors.billing.paymentCouldNotStarted'));
    return { item: await this.itemFor(tenant.studioId, key, now), pending: result.status === 'PENDING', checkoutUrl: result.checkoutUrl };
  }

  /** Cancel: usable until the period end (or the trial end), then the heartbeat expires it. Always allowed, also in restricted mode. */
  async cancel(tenant: TenantContext, actorUserId: string, key: string, now = new Date()): Promise<StudioAddOnActionResultDTO> {
    const addOn = await this.prisma.addOn.findUnique({ where: { key }, select: { id: true } });
    if (!addOn) throw addOnError(ADD_ON_ERROR_CODES.notFound, 'notFound');
    const row = await this.prisma.studioAddOn.findUnique({ where: { studioId_addOnId: { studioId: tenant.studioId, addOnId: addOn.id } } });
    if (!row || (row.status !== 'TRIALING' && row.status !== 'ACTIVE')) {
      throw addOnError(ADD_ON_ERROR_CODES.notCancellable, 'conflict');
    }
    const accessEnd = row.status === 'TRIALING' ? row.trialEndsAt : row.currentPeriodEnd;
    const moved = await this.prisma.studioAddOn.updateMany({
      where: { id: row.id, status: row.status },
      data: { status: 'CANCELLED', cancelledAt: now, currentPeriodEnd: accessEnd, nextRenewalAttemptAt: null },
    });
    if (moved.count === 0) throw new ConflictException(codedError(ADD_ON_ERROR_CODES.notCancellable, { statusCode: 409 }));
    await this.audit(tenant.studioId, actorUserId, 'add_on.cancel', row.id, { key, from: row.status, accessUntil: accessEnd?.toISOString() ?? null });
    return { item: await this.itemFor(tenant.studioId, key, now), pending: false, checkoutUrl: null };
  }

  /**
   * Effective features of the tenant for module-off empty states: which known
   * flags are on, and which of the off ones a published add-on would unlock
   * (with the add-on to send the owner to).
   */
  async features(studioId: string, now = new Date()): Promise<StudioFeaturesDTO> {
    const [addOns, flagRows] = await Promise.all([
      this.prisma.addOn.findMany({ where: { isPublished: true }, orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }], select: { key: true, name: true, featureFlagKey: true } }),
      this.prisma.featureFlag.findMany({ distinct: ['key'], select: { key: true } }),
    ]);
    const keys = [...new Set([...Object.keys(FEATURE_FLAGS), ...flagRows.map((f) => f.key), ...addOns.map((a) => a.featureFlagKey)])];
    const resolved = await resolveFeaturesForStudio(this.prisma, studioId, keys, now);
    const enabled = keys.filter((k) => resolved.get(k) === true);
    const unlockableBy = addOns
      .filter((a) => resolved.get(a.featureFlagKey) !== true)
      .map((a) => ({ featureFlagKey: a.featureFlagKey, addOnKey: a.key, name: toLocalizedText(a.name) }));
    return { enabled, unlockableBy };
  }

  // ---------------------------------------------------------------------------

  private async studio(studioId: string) {
    const studio = await this.prisma.studio.findUnique({
      where: { id: studioId },
      select: { id: true, billingStatus: true, isPlatform: true, countryCode: true, billingCurrency: true },
    });
    if (!studio) throw new NotFoundException(apiError('apiErrors.common.businessNotFound'));
    return studio;
  }

  /** Buying or trying needs a healthy account: restricted-mode tenants must activate their account first. */
  private async assertCanBuy(studioId: string) {
    const studio = await this.studio(studioId);
    if (studio.isPlatform) throw new BadRequestException(apiError('apiErrors.billing.platformTenantCannotAddApps'));
    if (isWriteRestricted(studio.billingStatus)) throw billingRestrictedError();
    return studio;
  }

  private async publishedAddOn(key: string) {
    const addOn = await this.prisma.addOn.findFirst({ where: { key, isPublished: true }, include: { prices: true } });
    if (!addOn) throw addOnError(ADD_ON_ERROR_CODES.notFound, 'notFound');
    return addOn;
  }

  private async itemFor(studioId: string, key: string, now: Date): Promise<StudioAddOnDTO> {
    const studio = await this.studio(studioId);
    const row = await this.prisma.addOn.findUniqueOrThrow({ where: { key }, include: { prices: true, studioAddOns: { where: { studioId } } } });
    return toTenantDto(row, studioBillingCurrency(studio), now);
  }

  private async audit(studioId: string, userId: string, action: string, entityId: string, metadata: Prisma.InputJsonObject): Promise<void> {
    await this.prisma.auditLog.create({ data: { studioId, userId, action, entityType: 'StudioAddOn', entityId, metadata } });
  }
}

/** The tenant's view of one add-on: state, access, and the price in the tenant's billing currency (null when there is none). */
export function toTenantDto(row: CatalogueRow, currency: string, now: Date): StudioAddOnDTO {
  const own = row.studioAddOns[0] ?? null;
  const price: AddOnPriceDTO | null = addOnPriceIn(toPriceDtos(row.prices), currency);
  const hasAccess = own ? addOnHasAccess(own, now) : false;
  const status: AddOnStatus | null = own && isAddOnStatus(own.status) ? own.status : null;
  let state: AddOnTenantState = 'AVAILABLE';
  if (status === 'ACTIVE') state = 'ACTIVE';
  else if (status === 'TRIALING') state = hasAccess ? 'TRIALING' : 'EXPIRED';
  else if (status === 'CANCELLED') state = hasAccess ? 'CANCELLED' : 'EXPIRED';
  else if (status === 'EXPIRED') state = own?.trialStartedAt || own?.activatedAt ? 'EXPIRED' : 'AVAILABLE';
  const purchasable = row.isPublished && price !== null;
  const interval = own?.billingInterval === 'MONTH' || own?.billingInterval === 'YEAR' ? own.billingInterval : null;
  return {
    key: row.key,
    name: toLocalizedText(row.name),
    description: toLocalizedText(row.description),
    promoVideoUrl: row.promoVideoUrl,
    screenshotUrls: toStringArray(row.screenshotUrls),
    featureFlagKey: row.featureFlagKey,
    trialDays: row.trialDays,
    state,
    hasAccess,
    trialEndsAt: own?.trialEndsAt?.toISOString() ?? null,
    trialDaysLeft: status === 'TRIALING' && hasAccess ? trialDaysLeft(own?.trialEndsAt, now) : null,
    activatedAt: own?.activatedAt?.toISOString() ?? null,
    cancelledAt: own?.cancelledAt?.toISOString() ?? null,
    currentPeriodEnd: own?.currentPeriodEnd?.toISOString() ?? null,
    billingInterval: state === 'ACTIVE' || state === 'CANCELLED' ? interval : null,
    price,
    purchasable,
    purchaseBlockedReason: price === null ? 'NO_PRICE_IN_CURRENCY' : null,
    trialAvailable: purchasable && row.trialDays > 0 && !own?.trialStartedAt,
    paymentOverdue: status === 'ACTIVE' && own?.currentPeriodEnd != null && own.currentPeriodEnd <= now,
  };
}
