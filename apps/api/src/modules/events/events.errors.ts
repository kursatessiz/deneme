import { BadRequestException, ConflictException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import type { EventErrorCode } from '@platform/shared';

/**
 * Event errors carry a stable `code` (EVENT_ERROR_CODES) next to an English
 * diagnostic message for logs; clients translate `events.error.<code>`.
 */
export function eventError(code: EventErrorCode): HttpException {
  const body = (statusCode: number, message: string) => ({ statusCode, code, message });
  switch (code) {
    case 'EVENT_NOT_FOUND':
      return new NotFoundException(body(404, 'Event not found'));
    case 'EVENT_NOT_PUBLISHED':
      return new ConflictException(body(409, 'Event is not open for registration'));
    case 'EVENT_NOT_EDITABLE':
      return new ConflictException(body(409, 'Event can no longer be changed'));
    case 'EVENT_REGISTRATION_CLOSED':
      return new ConflictException(body(409, 'Registration window is closed'));
    case 'EVENT_FULL':
      return new ConflictException(body(409, 'Event is full'));
    case 'EVENT_TICKET_UNAVAILABLE':
      return new BadRequestException(body(400, 'Ticket type is not on sale'));
    case 'EVENT_TICKET_SOLD_OUT':
      return new ConflictException(body(409, 'Ticket type is sold out'));
    case 'EVENT_MEMBERS_ONLY':
      return new ForbiddenException(body(403, 'Only members can register for this'));
    case 'EVENT_CURRENCY_MISMATCH':
      return new BadRequestException(body(400, 'Currency must be the studio currency'));
    case 'EVENT_CAPACITY_BELOW_TAKEN':
      return new BadRequestException(body(400, 'Capacity cannot go below the seats already taken'));
    case 'EVENT_PUBLISH_INCOMPLETE':
      return new BadRequestException(body(400, 'An event needs an occurrence and an active ticket type to be published'));
    case 'EVENT_SINGLE_OCCURRENCE':
      return new BadRequestException(body(400, 'A single event has exactly one occurrence'));
    case 'EVENT_NO_CREDITS':
      return new ConflictException(body(409, 'The package cannot pay for this ticket'));
    case 'EVENT_CREDITS_NOT_ACCEPTED':
      return new BadRequestException(body(400, 'This ticket cannot be paid with package credits'));
    case 'EVENT_PAYMENT_REQUIRED':
      return new BadRequestException(body(400, 'Payment is required for this ticket'));
    case 'EVENT_PAYMENT_PENDING':
      return new ConflictException(body(409, 'Payment is still pending'));
    case 'EVENT_REGISTRATION_NOT_CANCELLABLE':
      return new ConflictException(body(409, 'Registration cannot be cancelled'));
    case 'EVENT_REGISTRATION_NOT_CHECKABLE':
      return new ConflictException(body(409, 'Registration cannot be checked in'));
    case 'EVENT_TICKET_IN_USE':
      return new ConflictException(body(409, 'Ticket type has registrations'));
    case 'EVENT_OCCURRENCE_CONFLICT':
      return new ConflictException(body(409, 'Trainer or resource is busy at that time'));
  }
}
