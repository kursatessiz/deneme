import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import type { ApiErrorKey, CreateCheckInPointInput, UpdateCheckInWindowInput } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SchedulesService } from '../schedules/schedules.service';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { assertBranchAccess } from '../branches/branch-access';
import { signDynamicQrToken, verifyDynamicQrToken } from './dynamic-qr-token';
import { computeCheckInWindow } from './checkin-window';
import { DynamicQrNonceStore } from './dynamic-qr-nonce.store';
import { apiError } from '../../common/api-error';

const INVALID_QR = apiError('apiErrors.checkin.invalidQrCode');

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class CheckInService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly schedules: SchedulesService,
    private readonly config: ConfigService,
    private readonly nonces: DynamicQrNonceStore,
  ) {}

  // ---------------------------------------------------------------------------
  // Studio check-in window setting
  // ---------------------------------------------------------------------------

  async getWindow(studioId: string) {
    const studio = await this.prisma.studio.findUniqueOrThrow({
      where: { id: studioId },
      select: { checkInWindowBeforeMinutes: true, checkInWindowAfterMinutes: true },
    });
    return { beforeMinutes: studio.checkInWindowBeforeMinutes, afterMinutes: studio.checkInWindowAfterMinutes };
  }

  async updateWindow(tenant: TenantContext, dto: UpdateCheckInWindowInput) {
    await this.prisma.studio.update({
      where: { id: tenant.studioId },
      data: { checkInWindowBeforeMinutes: dto.beforeMinutes, checkInWindowAfterMinutes: dto.afterMinutes },
    });
    return { beforeMinutes: dto.beforeMinutes, afterMinutes: dto.afterMinutes };
  }

  // ---------------------------------------------------------------------------
  // Static check-in points (poster QR)
  // ---------------------------------------------------------------------------

  async createPoint(tenant: TenantContext, dto: CreateCheckInPointInput) {
    assertBranchAccess(tenant, dto.branchId);
    const branch = await this.prisma.branch.findFirst({ where: { id: dto.branchId, studioId: tenant.studioId } });
    if (!branch) throw new NotFoundException(apiError('apiErrors.common.branchNotFound'));

    const rawToken = randomBytes(24).toString('base64url'); // 192 bits
    const point = await this.prisma.checkInPoint.create({
      data: { studioId: tenant.studioId, branchId: dto.branchId, name: dto.name, tokenHash: hashToken(rawToken) },
    });
    return { ...this.presentPoint(point), token: rawToken, url: this.pointUrl(rawToken) };
  }

  async listPoints(tenant: TenantContext) {
    const points = await this.prisma.checkInPoint.findMany({
      where: { studioId: tenant.studioId, ...(tenant.branchIds ? { branchId: { in: [...tenant.branchIds] } } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return points.map((p) => this.presentPoint(p));
  }

  /** Invalidates the old QR poster; the raw token is returned once, for a new one. */
  async rotatePoint(tenant: TenantContext, pointId: string) {
    const point = await this.findOwnedPoint(tenant, pointId);
    const rawToken = randomBytes(24).toString('base64url');
    const updated = await this.prisma.checkInPoint.update({
      where: { id: point.id },
      data: { tokenHash: hashToken(rawToken) },
    });
    return { ...this.presentPoint(updated), token: rawToken, url: this.pointUrl(rawToken) };
  }

  async setPointActive(tenant: TenantContext, pointId: string, isActive: boolean) {
    const point = await this.findOwnedPoint(tenant, pointId);
    const updated = await this.prisma.checkInPoint.update({ where: { id: point.id }, data: { isActive } });
    return this.presentPoint(updated);
  }

  /** Member scan of the static branch/studio QR. Resolves the studio from the token itself. */
  async scanPoint(user: AuthUser, rawToken: string) {
    const point = await this.prisma.checkInPoint.findUnique({ where: { tokenHash: hashToken(rawToken) } });
    if (!point) throw new NotFoundException(INVALID_QR);
    if (!point.isActive) throw new BadRequestException(apiError('apiErrors.checkin.qrCodeNoLongerActiveAsk'));

    const membership = await this.prisma.membership.findUnique({
      where: { userId_studioId: { userId: user.id, studioId: point.studioId } },
      include: { memberProfile: true, studio: { select: { isActive: true } } },
    });
    if (!membership || membership.status !== 'ACTIVE' || !membership.studio.isActive || !membership.memberProfile) {
      throw new ForbiddenException(apiError('apiErrors.checkin.qrBelongsAnotherBusinessNoMembership'));
    }

    return this.resolveAndCheckIn(point.studioId, new Set([point.branchId]), membership.memberProfile.id, point.branchId);
  }

  private async resolveAndCheckIn(
    studioId: string,
    allowedBranchIds: ReadonlySet<string>,
    memberProfileId: string,
    nearMissBranchId: string,
  ) {
    const window = await this.getWindow(studioId);
    const now = new Date();
    const { windowStart, windowEnd } = computeCheckInWindow(now, window.beforeMinutes, window.afterMinutes);

    const candidates = await this.schedules.findCheckInCandidates(
      studioId,
      memberProfileId,
      allowedBranchIds,
      windowStart,
      windowEnd,
    );
    if (candidates.length === 0) {
      const nearMiss = await this.nearestUpcomingOrPast(studioId, memberProfileId, nearMissBranchId, now);
      throw new BadRequestException(apiError(nearMiss ?? 'apiErrors.checkin.noConfirmedBookingThisTime'));
    }

    const chosen = candidates[0];
    const booking = await this.schedules.checkInForMember(studioId, chosen.id, memberProfileId);
    return { bookingId: booking.id, status: booking.status, checkInAt: booking.checkInAt };
  }

  private async nearestUpcomingOrPast(
    studioId: string,
    memberId: string,
    branchId: string,
    now: Date,
  ): Promise<ApiErrorKey | null> {
    // Bounded to a few hours out: a booking days away should not make a
    // member think "too early, come back later" when they are really just
    // stopping by with nothing to check into right now.
    const NEAR_HORIZON_MS = 4 * 60 * 60 * 1000;
    const upcoming = await this.prisma.booking.findFirst({
      where: {
        studioId,
        memberId,
        status: 'CONFIRMED',
        schedule: { isCancelled: false, branchId, startTime: { gt: now, lte: new Date(now.getTime() + NEAR_HORIZON_MS) } },
      },
      orderBy: { schedule: { startTime: 'asc' } },
      include: { schedule: true },
    });
    if (upcoming) return 'apiErrors.checkin.windowNotOpenYet';

    const past = await this.prisma.booking.findFirst({
      where: {
        studioId,
        memberId,
        status: { in: ['CONFIRMED', 'ATTENDED'] },
        schedule: { branchId, startTime: { lt: now } },
      },
      orderBy: { schedule: { startTime: 'desc' } },
    });
    if (past) return 'apiErrors.checkin.windowClosed';

    return null;
  }

  private async findOwnedPoint(tenant: TenantContext, pointId: string) {
    const point = await this.prisma.checkInPoint.findFirst({ where: { id: pointId, studioId: tenant.studioId } });
    if (!point) throw new NotFoundException(apiError('apiErrors.checkin.checkPointNotFound'));
    assertBranchAccess(tenant, point.branchId);
    return point;
  }

  private presentPoint(point: { id: string; branchId: string; name: string; isActive: boolean; createdAt: Date }) {
    return { id: point.id, branchId: point.branchId, name: point.name, isActive: point.isActive, createdAt: point.createdAt };
  }

  private pointUrl(rawToken: string): string {
    return `${this.config.getOrThrow<string>('PUBLIC_APP_URL').replace(/\/$/, '')}/c/${rawToken}`;
  }

  // ---------------------------------------------------------------------------
  // Dynamic member QR (staff / kiosk scan)
  // ---------------------------------------------------------------------------

  async issueMemberQr(user: AuthUser, studioId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_studioId: { userId: user.id, studioId } },
      include: { memberProfile: true, studio: { select: { isActive: true } } },
    });
    if (!membership || membership.status !== 'ACTIVE' || !membership.studio.isActive || !membership.memberProfile) {
      throw new ForbiddenException(apiError('apiErrors.checkin.noActiveMembershipBusiness'));
    }
    const jwtSecret = this.config.getOrThrow<string>('JWT_SECRET');
    const { token, expiresAt } = signDynamicQrToken(jwtSecret, membership.id, studioId);
    return { token, expiresAt };
  }

  /**
   * Shared by the staff member-qr endpoint and the kiosk. `allowedBranchIds`
   * is null for unrestricted staff; otherwise every candidate booking and
   * disambiguation choice is filtered to those branches (defense in depth
   * on top of the caller's own branch check).
   */
  async checkInByMemberQr(
    studioId: string,
    allowedBranchIds: ReadonlySet<string> | null,
    rawToken: string,
    scheduleId?: string,
  ) {
    const jwtSecret = this.config.getOrThrow<string>('JWT_SECRET');
    const verified = verifyDynamicQrToken(jwtSecret, rawToken);
    if (!verified.ok) {
      if (verified.error === 'EXPIRED') throw new BadRequestException(apiError('apiErrors.checkin.qrCodeExpiredAskMemberGenerate'));
      throw new BadRequestException(INVALID_QR);
    }
    if (verified.payload.studioId !== studioId) {
      throw new ForbiddenException(apiError('apiErrors.checkin.qrBelongsAnotherBusiness'));
    }

    // Replay protection: the nonce is claimed only when a booking is actually
    // checked in (claimNonce below), so an ambiguous scan that returns the
    // candidates to pick from can be completed by a second call with the same token.
    const membership = await this.prisma.membership.findFirst({
      where: { id: verified.payload.membershipId, studioId },
      include: { memberProfile: true, studio: { select: { isActive: true } } },
    });
    if (!membership || membership.status !== 'ACTIVE' || !membership.studio.isActive || !membership.memberProfile) {
      throw new NotFoundException(apiError('apiErrors.common.memberNotFound'));
    }

    if (scheduleId) {
      const booking = await this.prisma.booking.findFirst({
        where: { studioId, scheduleId, memberId: membership.memberProfile.id, status: { in: ['CONFIRMED', 'ATTENDED'] } },
        include: { schedule: { select: { branchId: true } } },
      });
      if (!booking) throw new NotFoundException(apiError('apiErrors.checkin.noBookingFoundSession'));
      if (allowedBranchIds && booking.schedule.branchId && !allowedBranchIds.has(booking.schedule.branchId)) {
        throw new ForbiddenException(apiError('apiErrors.common.notPermissionBranch'));
      }
      await this.claimNonce(verified.payload.nonce);
      const checked = await this.schedules.checkInForMember(studioId, booking.id, membership.memberProfile.id);
      return { resolved: true as const, bookingId: checked.id, status: checked.status, checkInAt: checked.checkInAt };
    }

    const window = await this.getWindow(studioId);
    const now = new Date();
    const { windowStart, windowEnd } = computeCheckInWindow(now, window.beforeMinutes, window.afterMinutes);
    const candidates = await this.schedules.findCheckInCandidates(
      studioId,
      membership.memberProfile.id,
      allowedBranchIds,
      windowStart,
      windowEnd,
    );

    if (candidates.length === 0) {
      throw new BadRequestException(apiError('apiErrors.checkin.memberNoBookingCanChecked'));
    }
    if (candidates.length > 1) {
      // Ambiguous: let the caller (reception/kiosk UI) show today's bookings to pick from.
      return {
        resolved: false as const,
        member: { memberProfileId: membership.memberProfile.id, membershipId: membership.id },
        candidates: candidates.map((c) => ({
          bookingId: c.id,
          scheduleId: c.scheduleId,
          title: c.schedule.title,
          startTime: c.schedule.startTime,
        })),
      };
    }

    await this.claimNonce(verified.payload.nonce);
    const checked = await this.schedules.checkInForMember(studioId, candidates[0].id, membership.memberProfile.id);
    return { resolved: true as const, bookingId: checked.id, status: checked.status, checkInAt: checked.checkInAt };
  }

  private async claimNonce(nonce: string): Promise<void> {
    if (!(await this.nonces.claim(nonce))) {
      throw new ConflictException(apiError('apiErrors.checkin.qrCodeAlreadyUsedAskMember'));
    }
  }
}
