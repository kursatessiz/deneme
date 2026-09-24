import { BadRequestException, Body, Controller, ForbiddenException, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/tenant-context';
import { RatingPromptService } from './rating-prompt.service';

/**
 * Platform-wide rating-prompt trigger, not tied to a single studio. The
 * scheduler heartbeat (JobsService) runs the same work every 15 minutes;
 * this endpoint forces a run. `now` is honoured only under NODE_ENV=test.
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
    let now = new Date();
    if (body?.now && process.env.NODE_ENV === 'test') {
      now = new Date(body.now);
      if (Number.isNaN(now.getTime())) throw new BadRequestException('Geçersiz tarih');
    }
    return this.ratingPrompt.promptRecentAttendees(now);
  }
}
