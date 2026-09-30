import { Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { SuperAdminOnly } from '../../auth/decorators/super-admin-only.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/tenant-context';
import { MarketingSettingsService } from '../../growth/campaigns/approval/marketing-settings.service';
import { EmailDomainService } from './email-domain.service';

/**
 * Super admin: SES sender identity automation of the platform tenant's
 * sender domains (M5). The same super admin decorator as the marketing
 * settings; every provisioning is audit logged by the service.
 */
@Controller('admin/marketing/sender-domains')
@SuperAdminOnly()
export class AdminSenderDomainsController {
  constructor(
    private readonly domains: EmailDomainService,
    private readonly settings: MarketingSettingsService,
  ) {}

  /** Creates or fetches the SES identity with Easy DKIM, stores the DKIM tokens and returns the DNS records to publish. */
  @Post(':id/provision')
  @HttpCode(200)
  async provision(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.domains.provision(await this.settings.platformStudioId(), user.id, id);
  }
}
