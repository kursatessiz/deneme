import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SchedulesService } from '../schedules/schedules.service';
import { maskPhone } from '@platform/shared';
import type { PublicCreateBookingInput } from '@platform/shared';
import type { TenantContext } from '../auth/tenant-context';

/**
 * The read/write logic behind both `/v1/public/*` (API-key authenticated
 * third-party integrations, see PublicApiController) and the embeddable
 * booking widget's own lightweight public endpoints (rate-limited by IP
 * instead of an API key, see EmbedPublicController) -- the widget cannot
 * hold a secret API key in browser-visible JS, so it gets its own
 * unauthenticated-but-rate-limited surface that calls the same methods.
 *
 * Every write builds the synthetic staff-level TenantContext that the
 * existing schedules/booking service methods expect, so booking rules
 * (capacity, entitlement, cancellation policy) are reused exactly as-is
 * rather than reimplemented here.
 */
@Injectable()
export class PublicApiService {
  constructor(
    private prisma: PrismaService,
    private schedules: SchedulesService,
  ) {}

  private toStaffTenant(studioId: string): TenantContext {
    return {
      studioId,
      membershipId: null,
      isOwner: false,
      isSuperAdmin: false,
      permissions: new Set(),
      memberProfileId: null,
      trainerProfileId: null,
      branchIds: null, // studio-wide, not branch-restricted
    };
  }

  // ---------------------------------------------------------------------------
  // Read endpoints
  // ---------------------------------------------------------------------------

  async listBranches(studioId: string) {
    return this.prisma.branch.findMany({
      where: { studioId, isActive: true },
      select: { id: true, name: true, address: true, phone: true, timezone: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async listServiceTypes(studioId: string) {
    return this.prisma.serviceType.findMany({
      where: { studioId, isActive: true },
      select: { id: true, name: true, description: true, durationMin: true, capacity: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Used by both the API-key-gated /v1/public/schedules and the
   * unauthenticated embed widget. The select list is deliberately narrow:
   * no attendee/member data, no booking rows, no trainer contact info, no
   * meeting links -- only what a public schedule page may show. Widen this
   * only with a specific field in mind, never with `include`.
   */
  async listSchedules(studioId: string, branchId: string | undefined, from: Date, to: Date) {
    return this.prisma.sessionSchedule.findMany({
      where: {
        studioId,
        branchId,
        isCancelled: false,
        startTime: { gte: from },
        endTime: { lte: to },
      },
      select: {
        id: true,
        branchId: true,
        serviceTypeId: true,
        title: true,
        startTime: true,
        endTime: true,
        capacity: true,
        bookedCount: true,
      },
      orderBy: { startTime: 'asc' },
    });
  }

  async listBookings(
    studioId: string,
    filter: { branchId?: string; scheduleId?: string },
    page: number,
    pageSize: number,
    canSeePhone: boolean,
  ) {
    const where = {
      studioId,
      ...(filter.scheduleId ? { scheduleId: filter.scheduleId } : {}),
      ...(filter.branchId ? { schedule: { branchId: filter.branchId } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        include: { member: { include: { membership: { include: { user: true } } } }, schedule: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.booking.count({ where }),
    ]);
    return {
      items: items.map((b) => ({
        id: b.id,
        scheduleId: b.scheduleId,
        status: b.status,
        checkInAt: b.checkInAt,
        cancelledAt: b.cancelledAt,
        createdAt: b.createdAt,
        member: {
          firstName: b.member.membership.user.firstName,
          lastName: b.member.membership.user.lastName,
          phone: canSeePhone ? b.member.membership.user.phone : maskPhone(b.member.membership.user.phone),
        },
      })),
      total,
      page,
      pageSize,
    };
  }

  // ---------------------------------------------------------------------------
  // Write endpoints: bookings.write, for an existing member identified by phone.
  // ---------------------------------------------------------------------------

  /** Resolves an active studio's id and its embed-widget settings by slug, for the unauthenticated embed widget. */
  async resolveStudioForEmbed(slug: string) {
    const studio = await this.prisma.studio.findFirst({
      where: { slug, isActive: true },
      select: { id: true, name: true, embedAllowedOrigins: true, logoUrl: true, themeFamily: true, themePrimary: true, gradientPresetKey: true },
    });
    if (!studio) throw new NotFoundException(`'${slug}' stüdyosu bulunamadı`);
    return studio;
  }

  private async resolveMemberByPhone(studioId: string, phone: string) {
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user) throw new NotFoundException('Bu telefon numarasıyla kayıtlı bir kullanıcı bulunamadı');
    const membership = await this.prisma.membership.findUnique({
      where: { userId_studioId: { userId: user.id, studioId } },
      include: { memberProfile: true },
    });
    if (!membership || membership.status !== 'ACTIVE' || !membership.memberProfile) {
      throw new NotFoundException('Bu telefon numarasıyla kayıtlı aktif bir üye bulunamadı');
    }
    return membership.memberProfile;
  }

  async createBooking(studioId: string, dto: PublicCreateBookingInput) {
    const member = await this.resolveMemberByPhone(studioId, dto.memberPhone);
    const tenant = this.toStaffTenant(studioId);
    // SchedulesService.bookSession itself emits the booking.created webhook.
    return this.schedules.bookSession(tenant, {
      studioId,
      scheduleId: dto.scheduleId,
      memberId: member.id,
      memberPackageId: dto.memberPackageId,
      resourceIds: dto.resourceIds ?? [],
    });
  }

  async cancelBooking(studioId: string, bookingId: string, reason: string | undefined) {
    const booking = await this.prisma.booking.findFirst({ where: { id: bookingId, studioId } });
    if (!booking) throw new NotFoundException('Rezervasyon bulunamadı');
    const tenant = this.toStaffTenant(studioId);
    // SchedulesService.cancelBooking itself emits the booking.cancelled webhook.
    return this.schedules.cancelBooking(tenant, { bookingId, cancelledBy: 'STUDIO', reason, waivePenalty: false });
  }
}
