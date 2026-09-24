import { Controller, Post, UseGuards } from '@nestjs/common';
import { ScanCheckInPointSchema, ScanCheckInPointInput } from '@platform/shared';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodBody } from '../../common/zod-body.pipe';
import type { AuthUser } from '../auth/tenant-context';
import { CheckInService } from './checkin.service';
import { CheckInScanRateLimitGuard } from './checkin-rate-limit.guard';

const IssueMemberQrBodySchema = z.object({ studioId: z.string().uuid() });

/** The signed-in member's own check-in actions. Not studio-scoped by header:
 * the static scan resolves the studio from the QR token, and the dynamic QR
 * request names the studio explicitly since a member may belong to several. */
@Controller('me/check-in')
@UseGuards(JwtAuthGuard)
export class MeCheckInController {
  constructor(private readonly checkIn: CheckInService) {}

  @Post('scan')
  @UseGuards(CheckInScanRateLimitGuard)
  async scan(@CurrentUser() user: AuthUser, @ZodBody(ScanCheckInPointSchema) body: ScanCheckInPointInput) {
    return this.checkIn.scanPoint(user, body.token);
  }

  /** Returns a fresh dynamic QR payload; the app re-fetches this every ~45s. */
  @Post('qr')
  async issueQr(@CurrentUser() user: AuthUser, @ZodBody(IssueMemberQrBodySchema) body: { studioId: string }) {
    return this.checkIn.issueMemberQr(user, body.studioId);
  }
}
