import { Module } from '@nestjs/common';
import { InvitesModule } from '../invites/invites.module';
import { JobsModule } from '../jobs/jobs.module';
import { AdminTenantsController } from './admin-tenants.controller';
import { AdminTenantsService } from './admin-tenants.service';
import { AdminPlansController } from './admin-plans.controller';
import { AdminPlansService } from './admin-plans.service';
import { AdminBusinessTypesController } from './admin-business-types.controller';
import { AdminBusinessTypesService } from './admin-business-types.service';
import { AdminFeatureFlagsController } from './admin-feature-flags.controller';
import { FeatureFlagsService } from './feature-flags.service';
import { AdminSmsPackagesController } from './admin-sms-packages.controller';
import { AdminSmsPackagesService } from './admin-sms-packages.service';
import { AdminContentController } from './admin-content.controller';
import { AdminContentService } from './admin-content.service';
import { AdminBenchmarkController } from './admin-benchmark.controller';
import { AdminBenchmarkService } from './admin-benchmark.service';
import { AdminHealthController } from './admin-health.controller';
import { AdminHealthService } from './admin-health.service';

/**
 * Platform-owner (super-admin) panel: backlog 4.1-4.3. Every controller in
 * this module is under the `/admin/*` prefix and guarded by
 * @SuperAdminOnly() at controller level (CLAUDE.md security rule and the
 * task's guard requirement). PlanLimitsService (enforcement in member/
 * branch/invite creation) lives in its own global PlanLimitsModule, not
 * here, so tenant-facing modules do not need to import this whole module.
 */
@Module({
  imports: [InvitesModule, JobsModule],
  controllers: [
    AdminTenantsController,
    AdminPlansController,
    AdminBusinessTypesController,
    AdminFeatureFlagsController,
    AdminSmsPackagesController,
    AdminContentController,
    AdminBenchmarkController,
    AdminHealthController,
  ],
  providers: [
    AdminTenantsService,
    AdminPlansService,
    AdminBusinessTypesService,
    FeatureFlagsService,
    AdminSmsPackagesService,
    AdminContentService,
    AdminBenchmarkService,
    AdminHealthService,
  ],
  exports: [FeatureFlagsService],
})
export class AdminModule {}
