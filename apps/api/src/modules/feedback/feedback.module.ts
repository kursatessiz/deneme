import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LoyaltyCoreModule } from '../loyalty/loyalty-core.module';
import { RatingsService } from './ratings.service';
import { RatingsController } from './ratings.controller';
import { ReferralsService } from './referrals.service';
import { ReferralsController } from './referrals.controller';
import { ReferralLandingController } from './referral-landing.controller';
import { FeedbackSettingsService } from './feedback-settings.service';
import { FeedbackSettingsController } from './feedback-settings.controller';
import { RatingPromptService } from './rating-prompt.service';
import { FeedbackAdminController } from './feedback-admin.controller';

@Module({
  imports: [AuthModule, LoyaltyCoreModule],
  controllers: [
    RatingsController,
    ReferralsController,
    ReferralLandingController,
    FeedbackSettingsController,
    FeedbackAdminController,
  ],
  providers: [RatingsService, ReferralsService, FeedbackSettingsService, RatingPromptService],
  exports: [ReferralsService, RatingPromptService],
})
export class FeedbackModule {}
