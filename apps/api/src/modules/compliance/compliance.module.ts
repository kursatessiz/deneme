import { Global, Module } from '@nestjs/common';
import { ComplianceService } from './compliance.service';
import { TrConsentRegistryAdapter } from './tr-consent-registry.adapter';

/**
 * Region-aware sending rules (docs/BUYUME_VE_GLOBAL_MIMARI.md section 2.3):
 * consent, quiet hours and unsubscribe per recipient region. Global so
 * every module (notifications, automations) can inject ComplianceService
 * without importing this module explicitly. NotificationsModule is also
 * @Global(), so TrConsentRegistryAdapter can inject its ConsentService
 * without either module listing the other in `imports` (which would risk a
 * circular module dependency, since NotificationsService itself injects
 * ComplianceService).
 */
@Global()
@Module({
  providers: [ComplianceService, TrConsentRegistryAdapter],
  exports: [ComplianceService, TrConsentRegistryAdapter],
})
export class ComplianceModule {}
