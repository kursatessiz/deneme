import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ReferralsService } from './referrals.service';

/**
 * Unauthenticated landing info for a referral share link (e.g. an /r/:code
 * page on the public site). Returns only the studio name and offer text --
 * never member identities.
 */
@Controller('public/referrals')
export class ReferralLandingController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get(':code')
  async landing(@Param('code') code: string) {
    const result = await this.referrals.landing(code);
    if (!result) throw new NotFoundException('Tavsiye kodu bulunamadı');
    return result;
  }
}
