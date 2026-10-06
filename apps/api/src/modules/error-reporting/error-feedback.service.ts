import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ErrorCaptureService } from './error-capture.service';
import { apiError } from '../../common/api-error';

/**
 * The optional "what were you doing" note a user attaches to an error event
 * from the error screen (H3). The text arrives already scrubbed by the
 * controller (scrubFeedback); this service only decides who may attach it:
 * an event that belongs to a signed-in user accepts feedback only from that
 * same user, an anonymous event (public pages) from anyone who knows its
 * random id. A note is written once; the event's error group is untouched.
 */
@Injectable()
export class ErrorFeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly capture: ErrorCaptureService,
  ) {}

  async attach(eventId: string, callerUserId: string | null, feedback: string): Promise<void> {
    const event = await this.prisma.errorEvent.findUnique({ where: { id: eventId }, select: { id: true, userIdHash: true } });
    // The same answer for a missing event and one the caller does not own: ids are not probeable.
    if (!event) throw new NotFoundException(apiError('apiErrors.errorReporting.errorRecordNotFound'));
    if (event.userIdHash && (!callerUserId || this.capture.hashUserId(callerUserId) !== event.userIdHash)) {
      throw new NotFoundException(apiError('apiErrors.errorReporting.errorRecordNotFound'));
    }
    const updated = await this.prisma.errorEvent.updateMany({ where: { id: eventId, feedback: null }, data: { feedback } });
    if (updated.count === 0) throw new ConflictException(apiError('apiErrors.errorReporting.noteAlreadySentError'));
  }
}
