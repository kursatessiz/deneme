import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { PairKioskDeviceSchema, PairKioskDeviceInput, KioskCheckInSchema, KioskCheckInInput } from '@platform/shared';
import { ZodBody } from '../../common/zod-body.pipe';
import { KioskService } from './kiosk.service';
import { CheckInService } from './checkin.service';
import { KioskAuthGuard } from './kiosk-auth.guard';
import { Kiosk } from './kiosk.decorator';
import type { KioskContext } from './kiosk-context';
import { KioskPairRateLimitGuard } from './checkin-rate-limit.guard';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Kiosk-only surface. Every route here requires a kiosk-typed JWT
 * (KioskAuthGuard); a normal staff/member access token is rejected. The
 * pairing endpoint is the one exception: it is public and exchanges a
 * one-time human-typed code for that kiosk JWT.
 */
@Controller('kiosk')
export class KioskController {
  constructor(
    private readonly kioskService: KioskService,
    private readonly checkInService: CheckInService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('pair')
  @UseGuards(KioskPairRateLimitGuard)
  async pair(@ZodBody(PairKioskDeviceSchema) body: PairKioskDeviceInput) {
    return this.kioskService.pair(body.pairingCode);
  }

  @Get('sessions/today')
  @UseGuards(KioskAuthGuard)
  async todaySessions(@Kiosk() kiosk: KioskContext) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return this.prisma.sessionSchedule.findMany({
      where: { studioId: kiosk.studioId, branchId: kiosk.branchId, startTime: { gte: start, lt: end }, isCancelled: false },
      orderBy: { startTime: 'asc' },
      select: {
        id: true,
        title: true,
        startTime: true,
        endTime: true,
        capacity: true,
        bookedCount: true,
        serviceType: { select: { name: true } },
      },
    });
  }

  @Post('check-in')
  @UseGuards(KioskAuthGuard)
  async checkIn(@Kiosk() kiosk: KioskContext, @ZodBody(KioskCheckInSchema) body: KioskCheckInInput) {
    const result = await this.checkInService.checkInByMemberQr(kiosk.studioId, new Set([kiosk.branchId]), body.token, body.scheduleId);
    await this.prisma.auditLog
      .create({
        data: {
          studioId: kiosk.studioId,
          userId: null,
          action: 'kiosk.check-in',
          entityType: 'Booking',
          entityId: result.resolved ? result.bookingId : null,
          metadata: { deviceId: kiosk.deviceId, resolved: result.resolved },
        },
      })
      .catch(() => undefined);
    return result;
  }
}
