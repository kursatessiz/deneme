import { BadRequestException, ConflictException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import type { EventErrorCode } from '@platform/shared';
import { codedError } from '../../common/api-error';

/**
 * Event errors carry a stable `code` (EVENT_ERROR_CODES) next to the
 * translated message; clients translate `events.error.<code>`.
 */
export function eventError(code: EventErrorCode): HttpException {
  const body = (statusCode: number) => codedError(code, { statusCode });
  switch (code) {
    case 'EVENT_NOT_FOUND':
      return new NotFoundException(body(404));
    case 'EVENT_NOT_PUBLISHED':
      return new ConflictException(body(409));
    case 'EVENT_NOT_EDITABLE':
      return new ConflictException(body(409));
    case 'EVENT_REGISTRATION_CLOSED':
      return new ConflictException(body(409));
    case 'EVENT_FULL':
      return new ConflictException(body(409));
    case 'EVENT_TICKET_UNAVAILABLE':
      return new BadRequestException(body(400));
    case 'EVENT_TICKET_SOLD_OUT':
      return new ConflictException(body(409));
    case 'EVENT_MEMBERS_ONLY':
      return new ForbiddenException(body(403));
    case 'EVENT_CURRENCY_MISMATCH':
      return new BadRequestException(body(400));
    case 'EVENT_CAPACITY_BELOW_TAKEN':
      return new BadRequestException(body(400));
    case 'EVENT_PUBLISH_INCOMPLETE':
      return new BadRequestException(body(400));
    case 'EVENT_SINGLE_OCCURRENCE':
      return new BadRequestException(body(400));
    case 'EVENT_NO_CREDITS':
      return new ConflictException(body(409));
    case 'EVENT_CREDITS_NOT_ACCEPTED':
      return new BadRequestException(body(400));
    case 'EVENT_PAYMENT_REQUIRED':
      return new BadRequestException(body(400));
    case 'EVENT_PAYMENT_PENDING':
      return new ConflictException(body(409));
    case 'EVENT_REGISTRATION_NOT_CANCELLABLE':
      return new ConflictException(body(409));
    case 'EVENT_REGISTRATION_NOT_CHECKABLE':
      return new ConflictException(body(409));
    case 'EVENT_TICKET_IN_USE':
      return new ConflictException(body(409));
    case 'EVENT_OCCURRENCE_CONFLICT':
      return new ConflictException(body(409));
  }
}
