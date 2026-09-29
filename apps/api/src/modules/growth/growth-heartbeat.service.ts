import { Injectable } from '@nestjs/common';
import { ContactConsentService } from '../notifications/consent/contact-consent.service';
import { SegmentsService } from './segments/segments.service';
import { JourneyEngineService } from './journeys/journey-engine.service';
import { LegacyAutomationMigratorService } from './journeys/legacy-automation-migrator.service';
import { CampaignsService } from './campaigns/campaigns.service';
import { CampaignApprovalService } from './campaigns/approval/campaign-approval.service';
import { MarketingGuardsService, type MarketingGuardsResult } from './campaigns/marketing-guards.service';

export interface GrowthHeartbeatResult {
  legacyMigrated: number;
  segmentsRefreshed: number;
  segmentEntries: number;
  journeysScanned: number;
  journeysEnrolled: number;
  journeySteps: number;
  journeysCompleted: number;
  campaigns: { campaigns: number; sent: number; skipped: number; failed: number };
  /** M3b: approval requests past their TTL marked EXPIRED. */
  approvalsExpired: number;
  /** M3d: the e-mail fuse and the ad spend cap alerts. */
  marketingGuards: MarketingGuardsResult;
  contactConsentSync: { synced: number; failed: number };
}

/**
 * The growth part of the 15-minute scheduler heartbeat (JobsService), in
 * order: convert any remaining legacy automation rule (so the old and the
 * new engine never both send), refresh stale dynamic segments (which fires
 * segment_entered), scan time-based journey triggers, advance due journey
 * enrollments, expire approval requests past their TTL (M3b), run the
 * marketing guards (M3d: e-mail fuse, ad spend cap alerts), send due
 * campaign batches, push contact consent changes to
 * İYS. Every step is idempotent, so running it more often is harmless.
 */
@Injectable()
export class GrowthHeartbeatService {
  constructor(
    private readonly migrator: LegacyAutomationMigratorService,
    private readonly segments: SegmentsService,
    private readonly journeys: JourneyEngineService,
    private readonly campaigns: CampaignsService,
    private readonly approvals: CampaignApprovalService,
    private readonly guards: MarketingGuardsService,
    private readonly contactConsents: ContactConsentService,
  ) {}

  async run(now: Date): Promise<GrowthHeartbeatResult> {
    const legacy = await this.migrator.migratePending(now);
    const segments = await this.segments.refreshStale(now);
    const scan = await this.journeys.scanAll(now);
    const steps = await this.journeys.processDue(now);
    const approvals = await this.approvals.expireDue(now);
    // M3d: the fuse runs before sending, so a campaign it pauses does not send in the same run.
    const marketingGuards = await this.guards.run(now);
    const campaigns = await this.campaigns.processDue(now);
    const contactConsentSync = await this.contactConsents.syncPending();
    return {
      legacyMigrated: legacy.migrated,
      segmentsRefreshed: segments.refreshed,
      segmentEntries: segments.entered,
      journeysScanned: scan.scanned,
      journeysEnrolled: scan.enrolled,
      journeySteps: steps.advanced,
      journeysCompleted: steps.completed,
      campaigns,
      approvalsExpired: approvals.expired,
      marketingGuards,
      contactConsentSync,
    };
  }
}
