import { BadRequestException, ConflictException, ForbiddenException, HttpException } from '@nestjs/common';
import type { LoyaltyErrorCode } from '@platform/shared';

/**
 * Loyalty errors carry a stable `code` (LOYALTY_ERROR_CODES) next to the
 * Turkish log/diagnostic message; clients translate `loyalty.error.<code>`.
 */
export function loyaltyError(code: LoyaltyErrorCode): HttpException {
  switch (code) {
    case 'LOYALTY_DISABLED':
      return new ConflictException({ statusCode: 409, code, message: 'Sadakat programı bu işletmede kapalı' });
    case 'LOYALTY_INSUFFICIENT_BALANCE':
      return new ConflictException({ statusCode: 409, code, message: 'Puan bakiyesi yetersiz' });
    case 'LOYALTY_REWARD_INACTIVE':
      return new BadRequestException({ statusCode: 400, code, message: 'Ödül kullanılabilir durumda değil' });
    case 'LOYALTY_MEMBER_REDEEM_DISABLED':
      return new ForbiddenException({ statusCode: 403, code, message: 'Ödüller üye uygulamasından kullanılamıyor' });
    case 'LOYALTY_NO_ACTIVE_PACKAGE':
      return new ConflictException({ statusCode: 409, code, message: 'Hak eklenebilecek aktif bir paket yok' });
    case 'LOYALTY_CURRENCY_MISMATCH':
      return new BadRequestException({ statusCode: 400, code, message: 'Para birimi işletmenin para birimiyle aynı olmalıdır' });
  }
}
