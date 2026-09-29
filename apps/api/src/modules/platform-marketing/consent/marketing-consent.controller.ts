import { Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type { ConsentResendResultDTO } from '@platform/shared';
import { Platform, PlatformScoped, RequirePlatformPermission } from '../../auth/decorators/platform-scoped.decorator';
import type { PlatformContext } from '../../auth/tenant-context';
import { ConsentConfirmationService } from '../../notifications/consent/consent-confirmation.service';

/**
 * Double opt-in actions on platform contacts (M3e, docs/PAZARLAMA_MODULU.md
 * 6.4): resend the confirmation e-mail of a pending form consent. At most
 * 3 confirmation e-mails per contact in a rolling day (429
 * CONSENT_CONFIRMATION_RATE_LIMITED); every resend is audit logged.
 */
@Controller('platform/marketing/contacts')
@PlatformScoped()
export class PlatformMarketingContactsController {
  constructor(private readonly confirmations: ConsentConfirmationService) {}

  @Post(':id/resend-confirmation')
  @HttpCode(200)
  @RequirePlatformPermission('platform.marketing.manage')
  resendConfirmation(@Platform() platform: PlatformContext, @Param('id', ParseUUIDPipe) id: string): Promise<ConsentResendResultDTO> {
    return this.confirmations.resend(platform.platformStudioId, id, platform.userId);
  }
}
