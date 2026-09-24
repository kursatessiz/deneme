import { Body, Controller, ForbiddenException, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/tenant-context';
import { RatingPromptService } from './rating-prompt.service';

/**
 * Platform-wide rating-prompt trigger, not tied to a single studio. Same
 * pattern as apps/api/src/modules/payments/dunning.controller.ts: BullMQ is
 * not wired up in this API yet, so a super-admin (or an external cron
 * hitting this endpoint with a service token) drives
 * RatingPromptService.promptRecentAttendees.
 */
@Controller('admin/feedback')
export class FeedbackAdminController {
  constructor(private readonly ratingPrompt: RatingPromptService) {}

  @Post('rating-prompts/run')
  @UseGuards(JwtAuthGuard)
  async runRatingPrompts(@CurrentUser() user: AuthUser, @Body() body: { now?: string }) {
    if (!user.isSuperAdmin) {
      throw new ForbiddenException('Bu işlem için yetkiniz yok');
    }
    const now = body?.now ? new Date(body.now) : new Date();
    return this.ratingPrompt.promptRecentAttendees(now);
  }
}
