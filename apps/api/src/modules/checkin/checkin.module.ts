import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SchedulesModule } from '../schedules/schedules.module';
import { CheckInService } from './checkin.service';
import { CheckInController } from './checkin.controller';
import { MeCheckInController } from './me-checkin.controller';
import { KioskService } from './kiosk.service';
import { KioskAdminController } from './kiosk-admin.controller';
import { KioskController } from './kiosk.controller';
import { KioskAuthGuard } from './kiosk-auth.guard';
import { DynamicQrNonceStore } from './dynamic-qr-nonce.store';
import { CheckInScanRateLimitGuard, KioskPairRateLimitGuard } from './checkin-rate-limit.guard';

/**
 * Check-in kiosk and QR (W17): static branch/studio QR points, the member's
 * dynamic QR, and device-paired tablet kiosks. No turnstile/door
 * integration -- see docs/CHECKIN.md.
 */
@Module({
  imports: [AuthModule, SchedulesModule],
  controllers: [CheckInController, MeCheckInController, KioskAdminController, KioskController],
  providers: [
    CheckInService,
    KioskService,
    KioskAuthGuard,
    DynamicQrNonceStore,
    CheckInScanRateLimitGuard,
    KioskPairRateLimitGuard,
  ],
  exports: [CheckInService],
})
export class CheckInModule {}
