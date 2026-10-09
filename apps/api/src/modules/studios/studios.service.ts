import { cashInOf } from '../payments/cash-in';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BILLING_CURRENCY_LOCKED_ERROR_CODE, DashboardMetricsDTO, StudioRegion, studioBillingCurrency } from '@platform/shared';
import { loadAllowedThemeFamiliesForStudio } from '../appearance/theme-families';
import { apiError, codedError } from '../../common/api-error';

@Injectable()
export class StudiosService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.studio.findMany({
      where: { isActive: true },
      include: {
        branches: {
          include: { resources: true },
        },
      },
    });
  }

  async findBySlug(slug: string) {
    const studio = await this.prisma.studio.findFirst({
      where: { slug, isActive: true },
      select: {
        id: true,
        name: true,
        slug: true,
        logoUrl: true,
        themeFamily: true,
        themePrimary: true,
        gradientPresetKey: true,
        address: true,
        phone: true,
        timezone: true,
        embedAllowedOrigins: true,
      },
    });

    if (!studio) {
      throw new NotFoundException(apiError('apiErrors.common.businessSlugNotFound', { slug: slug }));
    }

    return { ...studio, allowedThemeFamilies: await loadAllowedThemeFamiliesForStudio(this.prisma, studio.id) };
  }

  async getEmbedSettings(studioId: string) {
    const studio = await this.prisma.studio.findUniqueOrThrow({
      where: { id: studioId },
      select: { id: true, embedAllowedOrigins: true },
    });
    return studio;
  }

  async updateEmbedSettings(studioId: string, userId: string, embedAllowedOrigins: string[]) {
    const studio = await this.prisma.studio.update({
      where: { id: studioId },
      data: { embedAllowedOrigins },
      select: { id: true, embedAllowedOrigins: true },
    });
    await this.prisma.auditLog.create({
      data: {
        studioId,
        userId,
        action: 'studio.embed_settings.update',
        entityType: 'Studio',
        entityId: studioId,
        metadata: { embedAllowedOrigins },
      },
    });
    return studio;
  }

  async getRegion(studioId: string): Promise<StudioRegion> {
    const studio = await this.prisma.studio.findUniqueOrThrow({
      where: { id: studioId },
      select: { countryCode: true, currency: true, timezone: true, taxRegime: true, pricesIncludeTax: true },
    });
    return {
      countryCode: studio.countryCode,
      currency: studio.currency,
      timezone: studio.timezone,
      taxRegime: studio.taxRegime as StudioRegion['taxRegime'],
      pricesIncludeTax: studio.pricesIncludeTax,
    };
  }

  async updateRegion(studioId: string, userId: string, region: StudioRegion): Promise<StudioRegion> {
    const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: studioId }, select: { currency: true, countryCode: true, billingCurrency: true } });
    // G5c-1b: the platform billing currency follows the country unless the
    // super admin pinned it; once a platform payment has completed a country
    // change may not move it (only the super admin can override it).
    const billingBefore = studioBillingCurrency(studio);
    const billingAfter = studioBillingCurrency({ countryCode: region.countryCode, billingCurrency: studio.billingCurrency });
    if (billingBefore !== billingAfter) {
      const paid = await this.prisma.platformBillingPayment.findFirst({ where: { studioId, status: { in: ['COMPLETED', 'PENDING'] } }, select: { id: true } });
      if (paid) {
        throw new ConflictException(codedError(BILLING_CURRENCY_LOCKED_ERROR_CODE, { statusCode: 409 }));
      }
    }
    if (region.currency !== studio.currency) {
      const hasPayments = await this.prisma.payment.findFirst({ where: { studioId }, select: { id: true } });
      if (hasPayments) {
        throw new ConflictException(
          apiError('apiErrors.studios.businessRecordedPaymentsCurrencyCannotChanged'),
        );
      }
    }
    const updated = await this.prisma.studio.update({
      where: { id: studioId },
      data: {
        countryCode: region.countryCode,
        currency: region.currency,
        timezone: region.timezone,
        taxRegime: region.taxRegime,
        pricesIncludeTax: region.pricesIncludeTax,
      },
      select: { countryCode: true, currency: true, timezone: true, taxRegime: true, pricesIncludeTax: true },
    });
    await this.prisma.auditLog.create({
      data: {
        studioId,
        userId,
        action: 'studio.region.update',
        entityType: 'Studio',
        entityId: studioId,
        metadata: { ...region },
      },
    });
    return { ...updated, taxRegime: updated.taxRegime as StudioRegion['taxRegime'] };
  }

  async getDashboardMetrics(studioId: string): Promise<DashboardMetricsDTO> {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const startOfMonth = new Date(startOfToday.getFullYear(), startOfToday.getMonth(), 1);

    // 1. Today's sessions & bookings
    const todaySchedules = await this.prisma.sessionSchedule.findMany({
      where: {
        studioId,
        startTime: { gte: startOfToday, lte: endOfToday },
        isCancelled: false,
      },
      include: {
        bookings: {
          where: { status: { in: ['CONFIRMED', 'ATTENDED'] } },
        },
      },
    });

    const todaySessionsCount = todaySchedules.length;
    const todayAttendeesCount = todaySchedules.reduce((acc, s) => acc + s.bookings.length, 0);

    // 2. Active members
    const activeMembersCount = await this.prisma.memberProfile.count({
      where: {
        studioId,
        membership: { status: 'ACTIVE' },
      },
    });

    // 3. Expiring packages (within next 7 days or <= 2 units left)
    const sevenDaysLater = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const expiringPackagesCount = await this.prisma.memberPackage.count({
      where: {
        studioId,
        status: 'ACTIVE',
        OR: [{ remainingUnits: { lte: 2 } }, { endDate: { lte: sevenDaysLater } }],
      },
    });

    // 4. Monthly revenue from payments
    const payments = await this.prisma.payment.findMany({
      where: {
        studioId,
        paymentStatus: 'COMPLETED',
        paidAt: { gte: startOfMonth },
      },
      select: { amount: true, giftCardAmount: true },
    });

    const monthlyRevenue = payments.reduce((sum, p) => sum + cashInOf(p).toNumber(), 0);

    // 5. Occupancy rate (today's booked seats vs capacity)
    const totalCapacity = todaySchedules.reduce((acc, s) => acc + s.capacity, 0);
    const occupancyRate = totalCapacity > 0 ? (todayAttendeesCount / totalCapacity) * 100 : 0;

    return {
      todaySessionsCount,
      todayAttendeesCount,
      activeMembersCount,
      expiringPackagesCount,
      monthlyRevenue,
      occupancyRate: Math.round(occupancyRate * 10) / 10,
    };
  }
}
