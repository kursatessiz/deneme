import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { SuperAdminOnly } from '../auth/decorators/super-admin-only.decorator';
import { RatingPromptService } from './rating-prompt.service';
import { apiError } from '../../common/api-error';

/**
 * Platform-wide rating-prompt trigger, not tied to a single studio. The
 * scheduler heartbeat (JobsService) runs the same work every 15 minutes;
 * this endpoint forces a run. `now` is honoured only under NODE_ENV=test.
 */
@Controller('admin/feedback')
@SuperAdminOnly()
export class FeedbackAdminController {
  constructor(private readonly ratingPrompt: RatingPromptService) {}

  @Post('rating-prompts/run')
  async runRatingPrompts(@Body() body: { now?: string }) {
    let now = new Date();
    if (body?.now && process.env.NODE_ENV === 'test') {
      now = new Date(body.now);
      if (Number.isNaN(now.getTime())) throw new BadRequestException(apiError('apiErrors.feedback.invalidDate'));
    }
    return this.ratingPrompt.promptRecentAttendees(now);
  }
}
