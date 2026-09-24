import { Injectable } from '@nestjs/common';
import {
  EntitlementKind,
  type ActivePackageSummaryDTO,
  type MeSummaryDTO,
  type MeUpcomingBookingsDTO,
  type StudioMembershipSummaryDTO,
  type UpcomingBookingDTO,
} from '@platform/shared';
import { Prisma } from '@platform/database';
import { PrismaService } from '../prisma/prisma.service';

/** Include shape shared by the upcoming-bookings and ICS feed queries. */
const BOOKING_INCLUDE = {
  studio: { select: { id: true, name: true } },
  schedule: {
    include: {
      serviceType: { select: { name: true } },
      branch: { select: { name: true } },
      trainer: {
        include: { membership: { include: { user: { select: { firstName: true, lastName: true } } } } },
      },
    },
  },
  resources: { include: { resource: { select: { name: true } } } },
} as const;

/**
 * Data behind "Hesabım" widgets: the caller's own upcoming bookings and a
 * per-studio summary (next booking, active packages), across every studio
 * they belong to. Always scoped to the authenticated user's own
 * MemberProfile rows; never accepts another user's id.
 */
@Injectable()
export class MeBookingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getUpcomingBookings(userId: string): Promise<MeUpcomingBookingsDTO> {
    const memberProfileIds = await this.memberProfileIdsFor(userId);
    if (memberProfileIds.length === 0) return { items: [] };

    const bookings = await this.prisma.booking.findMany({
      where: {
        memberId: { in: memberProfileIds },
        status: 'CONFIRMED',
        schedule: { isCancelled: false, startTime: { gte: new Date() } },
      },
      include: BOOKING_INCLUDE,
      orderBy: { schedule: { startTime: 'asc' } },
    });

    return { items: bookings.map(toUpcomingBookingDTO) };
  }

  async getSummary(userId: string): Promise<MeSummaryDTO> {
    const memberProfiles = await this.prisma.memberProfile.findMany({
      // Only live memberships: a member who left a studio stops seeing it here and in the feed.
      where: { membership: { userId, status: 'ACTIVE', studio: { isActive: true } } },
      select: { id: true, studioId: true, membership: { select: { studio: { select: { id: true, name: true } } } } },
    });
    if (memberProfiles.length === 0) return { nextBooking: null, studios: [] };

    const memberProfileIds = memberProfiles.map((m) => m.id);
    const now = new Date();

    const [nextBookings, activePackages] = await Promise.all([
      this.prisma.booking.findMany({
        where: {
          memberId: { in: memberProfileIds },
          status: 'CONFIRMED',
          schedule: { isCancelled: false, startTime: { gte: now } },
        },
        include: BOOKING_INCLUDE,
        orderBy: { schedule: { startTime: 'asc' } },
      }),
      this.prisma.memberPackage.findMany({
        where: { memberId: { in: memberProfileIds }, status: 'ACTIVE', endDate: { gte: now } },
        include: { packageDefinition: { select: { name: true } }, studio: { select: { id: true, name: true } } },
        orderBy: { endDate: 'asc' },
      }),
    ]);

    const studioById = new Map(memberProfiles.map((m) => [m.studioId, m.membership.studio]));
    const summaries = new Map<string, StudioMembershipSummaryDTO>();
    for (const [studioId, studio] of studioById) {
      summaries.set(studioId, { studioId, studioName: studio.name, nextBooking: null, activePackages: [] });
    }

    for (const booking of nextBookings) {
      const dto = toUpcomingBookingDTO(booking);
      const entry = summaries.get(dto.studioId);
      if (entry && !entry.nextBooking) entry.nextBooking = dto;
    }

    for (const pkg of activePackages) {
      const entry = summaries.get(pkg.studioId);
      if (!entry) continue;
      const dto: ActivePackageSummaryDTO = {
        memberPackageId: pkg.id,
        studioId: pkg.studioId,
        studioName: pkg.studio.name,
        packageName: pkg.packageDefinition.name,
        // Prisma's generated enum and @platform/shared's EntitlementKind share the same string
        // values but are distinct nominal types; the string form is the single source of truth.
        entitlementKind: EntitlementKind[pkg.entitlementKind as keyof typeof EntitlementKind],
        remainingUnits: pkg.entitlementKind === 'TIME_UNLIMITED' ? null : (pkg.remainingUnits ?? 0),
        endDate: pkg.endDate.toISOString(),
      };
      entry.activePackages.push(dto);
    }

    const studios = Array.from(summaries.values());
    const nextBooking = studios
      .map((s) => s.nextBooking)
      .filter((b): b is UpcomingBookingDTO => b != null)
      .sort((a, b) => a.startTime.localeCompare(b.startTime))[0];

    return { nextBooking: nextBooking ?? null, studios };
  }

  /** All MemberProfile ids for this user, across every studio. */
  async memberProfileIdsFor(userId: string): Promise<string[]> {
    const rows = await this.prisma.memberProfile.findMany({
      // Only live memberships: a member who left a studio stops seeing it here and in the feed.
      where: { membership: { userId, status: 'ACTIVE', studio: { isActive: true } } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
}

type BookingWithScheduleAndResources = Prisma.BookingGetPayload<{ include: typeof BOOKING_INCLUDE }>;

function toUpcomingBookingDTO(booking: BookingWithScheduleAndResources): UpcomingBookingDTO {
  const trainerUser = booking.schedule.trainer?.membership?.user;
  return {
    bookingId: booking.id,
    studioId: booking.studioId,
    studioName: booking.studio.name,
    branchName: booking.schedule.branch?.name ?? null,
    serviceName: booking.schedule.serviceType.name,
    startTime: booking.schedule.startTime.toISOString(),
    endTime: booking.schedule.endTime.toISOString(),
    trainerName: trainerUser ? `${trainerUser.firstName} ${trainerUser.lastName}` : null,
    resourceNames: booking.resources.filter((r) => r.isActive).map((r) => r.resource.name),
  };
}
