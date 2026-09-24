import { Controller, Get, Param } from '@nestjs/common';
import { PromotionsService } from './promotions.service';

/**
 * No JWT, no tenant guard: mirrors GET /studios/public/:slug. Used by the
 * public booking page to show a studio's trial offers before signup.
 */
@Controller('studios/public')
export class PromotionsPublicController {
  constructor(private promotions: PromotionsService) {}

  @Get(':slug/trial-offers')
  async listTrialOffers(@Param('slug') slug: string) {
    return this.promotions.listPublicTrialOffers(slug);
  }
}
