import { BadRequestException, ConflictException, ForbiddenException, HttpException } from '@nestjs/common';
import type { LoyaltyErrorCode } from '@platform/shared';
import { codedError } from '../../common/api-error';

/**
 * Loyalty errors carry a stable `code` (LOYALTY_ERROR_CODES) next to the
 * translated message; clients translate `loyalty.error.<code>`.
 */
export function loyaltyError(code: LoyaltyErrorCode): HttpException {
  switch (code) {
    case 'LOYALTY_DISABLED':
      return new ConflictException(codedError(code, { statusCode: 409 }));
    case 'LOYALTY_INSUFFICIENT_BALANCE':
      return new ConflictException(codedError(code, { statusCode: 409 }));
    case 'LOYALTY_REWARD_INACTIVE':
      return new BadRequestException(codedError(code, { statusCode: 400 }));
    case 'LOYALTY_MEMBER_REDEEM_DISABLED':
      return new ForbiddenException(codedError(code, { statusCode: 403 }));
    case 'LOYALTY_NO_ACTIVE_PACKAGE':
      return new ConflictException(codedError(code, { statusCode: 409 }));
    case 'LOYALTY_CURRENCY_MISMATCH':
      return new BadRequestException(codedError(code, { statusCode: 400 }));
  }
}
