import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { BookingStatus, MembershipStatus, Prisma, type PrismaClient } from '@platform/database';
import { normalizePhone, parsePartnerConnectionConfig, type PartnerWebhookPayload } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { computeReservedSpots, isAllocationClosed } from './partner-quota';

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export interface PartnerBookingResult {
  bookingId: string;
  status: string;
  idempotent: boolean;
}

const CAPACITY_FULL = 'Seans dolu';
const QUOTA_FULL = 'Bu partner için ayrılan kontenjan dolu';
const QUOTA_RELEASED = 'Bu seans için partner kontenjanı serbest bırakılmıştır';

/**
 * Inbound side of W20: turns a verified partner webhook event into a real
 * Booking without requiring the guest to onboard into the app (no
 * InviteToken/OTP/consent flow). Capacity and the partner's own spot quota
 * are enforced atomically with the same conditional-update pattern
 * SchedulesService uses, so concurrent webhook deliveries can never
 * overbook a session or exceed a partner's allotted spots.
 */
@Injectable()
export class PartnerReservationsService {
  constructor(private readonly prisma: PrismaService) {}

  async createReservation(
    studioId: string,
    connectionId: string,
    payload: PartnerWebhookPayload,
  ): Promise<PartnerBookingResult> {
    // Idempotent by (connectionId, externalReservationId): a retried
    // creation (new webhook eventId, same underlying reservation) is a
    // no-op that returns the booking already on file.
    const existing = await this.prisma.booking.findFirst({
      where: { partnerConnectionId: connectionId, externalReservationId: payload.externalReservationId },
    });
    if (existing) {
      return { bookingId: existing.id, status: existing.status, idempotent: true };
    }

    const connection = await this.prisma.partnerConnection.findFirst({ where: { id: connectionId, studioId } });
    if (!connection) throw new NotFoundException('Partner bağlantısı bulunamadı');
    const config = parsePartnerConnectionConfig(connection.config);

    const scheduleId = payload.scheduleId;
    if (!scheduleId) {
      throw new BadRequestException('scheduleId belirtilmelidir (scheduleExternalId eşlemesi henüz desteklenmiyor)');
    }
    const schedule = await this.prisma.sessionSchedule.findFirst({ where: { id: scheduleId, studioId } });
    if (!schedule || schedule.isCancelled) {
      throw new BadRequestException('Seans bulunamadı veya iptal edilmiş');
    }
    if (config.serviceTypeIds.length > 0 && !config.serviceTypeIds.includes(schedule.serviceTypeId)) {
      throw new BadRequestException('Bu hizmet türü partner ile paylaşılmamış');
    }
    if (config.branchIds.length > 0 && schedule.branchId && !config.branchIds.includes(schedule.branchId)) {
      throw new BadRequestException('Bu şube partner ile paylaşılmamış');
    }

    return this.prisma.$transaction(async (tx) => {
      const releaseAt = new Date(schedule.startTime.getTime() - config.releaseHoursBeforeStart * 60 * 60 * 1000);

      const allocation = await this.ensureAllocation(tx, studioId, connectionId, schedule, config, releaseAt);
      if (isAllocationClosed(allocation.isReleased, allocation.releaseAt, new Date())) {
        throw new ConflictException(QUOTA_RELEASED);
      }

      const quotaResult = await tx.partnerSpotAllocation.updateMany({
        where: { id: allocation.id, usedSpots: { lt: allocation.reservedSpots } },
        data: { usedSpots: { increment: 1 } },
      });
      if (quotaResult.count === 0) {
        throw new ConflictException(QUOTA_FULL);
      }

      const capacityResult = await tx.sessionSchedule.updateMany({
        where: { id: scheduleId, studioId, isCancelled: false, bookedCount: { lt: schedule.capacity } },
        data: { bookedCount: { increment: 1 } },
      });
      if (capacityResult.count === 0) {
        throw new ConflictException(CAPACITY_FULL);
      }

      const { memberProfileId, partnerGuestId } = await this.resolvePartnerGuest(tx, studioId, connectionId, payload);

      let booking;
      try {
        booking = await tx.booking.create({
          data: {
            studioId,
            scheduleId,
            memberId: memberProfileId,
            status: BookingStatus.CONFIRMED,
            unitsCharged: 0,
            partnerConnectionId: connectionId,
            externalReservationId: payload.externalReservationId,
            partnerGuestId,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException('Bu rezervasyon zaten kaydedilmiş');
        }
        throw err;
      }

      await tx.auditLog.create({
        data: {
          studioId,
          action: 'partner_booking.create',
          entityType: 'Booking',
          entityId: booking.id,
          metadata: { connectionId, externalReservationId: payload.externalReservationId },
        },
      });

      return { bookingId: booking.id, status: booking.status, idempotent: false };
    });
  }

  async cancelReservation(
    studioId: string,
    connectionId: string,
    payload: PartnerWebhookPayload,
  ): Promise<PartnerBookingResult> {
    const booking = await this.prisma.booking.findFirst({
      where: { partnerConnectionId: connectionId, externalReservationId: payload.externalReservationId },
    });
    if (!booking) {
      throw new NotFoundException('İptal edilecek partner rezervasyonu bulunamadı');
    }
    if (booking.status === BookingStatus.CANCELLED_EARLY || booking.status === BookingStatus.CANCELLED_LATE) {
      return { bookingId: booking.id, status: booking.status, idempotent: true };
    }

    const connection = await this.prisma.partnerConnection.findFirst({ where: { id: connectionId, studioId } });
    if (!connection) throw new NotFoundException('Partner bağlantısı bulunamadı');
    const config = parsePartnerConnectionConfig(connection.config);

    // Partner cancellations follow the partner's own policy flag, not the
    // studio's CancellationPolicy: no late-cancellation penalty is ever
    // applied here, only what the partner itself reports.
    const isLate =
      config.followsPartnerCancellationPolicy && payload.cancelledWithinPartnerPolicy === false;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.booking.updateMany({
        where: { id: booking.id, status: { in: [BookingStatus.CONFIRMED, BookingStatus.WAITLIST] } },
        data: {
          status: isLate ? BookingStatus.CANCELLED_LATE : BookingStatus.CANCELLED_EARLY,
          cancelledAt: new Date(),
          cancellationReason: 'Partner tarafından iptal edildi',
          isLateCancellation: isLate,
          partnerCancelled: true,
        },
      });
      if (updated.count === 0) {
        return { bookingId: booking.id, status: booking.status, idempotent: true };
      }

      await tx.sessionSchedule.updateMany({
        where: { id: booking.scheduleId, studioId, bookedCount: { gt: 0 } },
        data: { bookedCount: { decrement: 1 } },
      });
      await tx.partnerSpotAllocation.updateMany({
        where: { connectionId, scheduleId: booking.scheduleId, usedSpots: { gt: 0 } },
        data: { usedSpots: { decrement: 1 } },
      });
      await tx.auditLog.create({
        data: {
          studioId,
          action: 'partner_booking.cancel',
          entityType: 'Booking',
          entityId: booking.id,
          metadata: { connectionId, externalReservationId: payload.externalReservationId, isLate },
        },
      });

      return { bookingId: booking.id, status: isLate ? BookingStatus.CANCELLED_LATE : BookingStatus.CANCELLED_EARLY, idempotent: false };
    });
  }

  async recordCheckIn(
    studioId: string,
    connectionId: string,
    payload: PartnerWebhookPayload,
  ): Promise<PartnerBookingResult> {
    const booking = await this.prisma.booking.findFirst({
      where: { partnerConnectionId: connectionId, externalReservationId: payload.externalReservationId },
    });
    if (!booking) {
      throw new NotFoundException('Check-in yapılacak partner rezervasyonu bulunamadı');
    }
    if (booking.status === BookingStatus.ATTENDED) {
      return { bookingId: booking.id, status: booking.status, idempotent: true };
    }
    const updated = await this.prisma.booking.update({
      where: { id: booking.id },
      data: { status: BookingStatus.ATTENDED, checkInAt: new Date() },
    });
    await this.prisma.auditLog.create({
      data: {
        studioId,
        action: 'partner_booking.check_in',
        entityType: 'Booking',
        entityId: booking.id,
        metadata: { connectionId, externalReservationId: payload.externalReservationId },
      },
    });
    return { bookingId: updated.id, status: updated.status, idempotent: false };
  }

  private async ensureAllocation(
    tx: Tx,
    studioId: string,
    connectionId: string,
    schedule: { id: string; capacity: number; bookedCount: number; startTime: Date },
    config: ReturnType<typeof parsePartnerConnectionConfig>,
    releaseAt: Date,
  ) {
    const existing = await tx.partnerSpotAllocation.findUnique({
      where: { connectionId_scheduleId: { connectionId, scheduleId: schedule.id } },
    });
    if (existing) return existing;

    const freeCapacity = Math.max(0, schedule.capacity - schedule.bookedCount);
    const reservedSpots = computeReservedSpots(config.spotsPerSession, freeCapacity);
    // createMany + skipDuplicates never throws on a concurrent conflict (it
    // just inserts nothing), unlike create(), which would raise P2002 and
    // abort the whole Postgres transaction - a caught JS error cannot
    // "un-abort" it, so every later query in the same transaction would
    // fail with 25P02. This keeps two racing reservations for the same
    // schedule both able to read the one allocation row that wins.
    await tx.partnerSpotAllocation.createMany({
      data: [{ studioId, connectionId, scheduleId: schedule.id, reservedSpots, usedSpots: 0, releaseAt }],
      skipDuplicates: true,
    });
    return tx.partnerSpotAllocation.findUniqueOrThrow({
      where: { connectionId_scheduleId: { connectionId, scheduleId: schedule.id } },
    });
  }

  /**
   * Resolves the global User + Membership + MemberProfile chain a partner
   * booking's Booking.memberId must point at, and the PartnerGuest row that
   * carries the partner's own guest identity for display and reporting.
   *
   * - Phone given: reuse-or-create the global User by phone (CLAUDE.md rule
   *   6), so a repeat guest is recognised across visits.
   * - No phone but a stable externalGuestId: reuse the placeholder chain
   *   created for that guest on an earlier visit, if any.
   * - Otherwise: create a fresh placeholder User (never a real phone) that
   *   exists only to satisfy Booking.memberId; PartnerGuest.fullName is the
   *   guest identity actually shown anywhere in the product.
   */
  private async resolvePartnerGuest(
    tx: Tx,
    studioId: string,
    connectionId: string,
    payload: PartnerWebhookPayload,
  ): Promise<{ memberProfileId: string; partnerGuestId: string }> {
    const guest = payload.guest ?? { fullName: 'Partner misafiri' };
    const normalizedPhone = guest.phone ? normalizePhone(guest.phone) : null;

    if (!normalizedPhone && guest.externalGuestId) {
      const existingGuest = await tx.partnerGuest.findFirst({
        where: { connectionId, externalGuestId: guest.externalGuestId },
      });
      if (existingGuest) {
        const memberProfileId = await this.memberProfileIdForUser(tx, studioId, existingGuest.userId);
        return { memberProfileId, partnerGuestId: existingGuest.id };
      }
    }

    const roleTemplate = await tx.roleTemplate.findFirst({ where: { studioId, key: 'member' } });
    if (!roleTemplate) throw new NotFoundException('Üye rol şablonu bulunamadı');

    let user = normalizedPhone ? await tx.user.findUnique({ where: { phone: normalizedPhone } }) : null;
    let isPlaceholder = false;
    if (!user) {
      isPlaceholder = !normalizedPhone;
      const [firstName, ...rest] = guest.fullName.trim().split(/\s+/);
      user = await tx.user.create({
        data: {
          phone: normalizedPhone ?? this.generatePlaceholderPhone(),
          firstName: firstName || 'Partner',
          lastName: rest.join(' ') || 'Misafiri',
          isActive: !isPlaceholder,
        },
      });
    }

    let membership = await tx.membership.findUnique({
      where: { userId_studioId: { userId: user.id, studioId } },
    });
    if (!membership) {
      membership = await tx.membership.create({
        data: { userId: user.id, studioId, roleTemplateId: roleTemplate.id, status: MembershipStatus.ACTIVE, joinedAt: new Date() },
      });
    }

    let memberProfile = await tx.memberProfile.findUnique({ where: { membershipId: membership.id } });
    if (!memberProfile) {
      memberProfile = await tx.memberProfile.create({
        data: { membershipId: membership.id, studioId },
      });
    }

    const partnerGuest = await tx.partnerGuest.create({
      data: {
        studioId,
        connectionId,
        userId: user.id,
        externalGuestId: guest.externalGuestId ?? null,
        phone: guest.phone ?? null,
        fullName: guest.fullName,
        isPlaceholder,
      },
    });

    return { memberProfileId: memberProfile.id, partnerGuestId: partnerGuest.id };
  }

  private async memberProfileIdForUser(tx: Tx, studioId: string, userId: string): Promise<string> {
    const membership = await tx.membership.findUnique({ where: { userId_studioId: { userId, studioId } } });
    if (!membership) throw new NotFoundException('Partner misafiri üyeliği bulunamadı');
    const profile = await tx.memberProfile.findUnique({ where: { membershipId: membership.id } });
    if (!profile) throw new NotFoundException('Partner misafiri üye kartı bulunamadı');
    return profile.id;
  }

  /** Never a valid phone shape: "GP-" (guest placeholder) plus 16 random hex chars, well inside VarChar(20). */
  private generatePlaceholderPhone(): string {
    return `GP-${randomBytes(8).toString('hex')}`;
  }
}
