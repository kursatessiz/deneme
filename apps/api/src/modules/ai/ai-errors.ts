import { HttpException, HttpStatus } from '@nestjs/common';
import { apiErrorBaseMessageForCode } from '@platform/shared';
import type { AiErrorCode } from '@platform/shared';

const STATUS: Record<AiErrorCode, HttpStatus> = {
  AI_NOT_CONFIGURED: HttpStatus.SERVICE_UNAVAILABLE,
  AI_MONTHLY_LIMIT_REACHED: HttpStatus.TOO_MANY_REQUESTS,
  AI_AUTH_FAILED: HttpStatus.BAD_GATEWAY,
  AI_RATE_LIMITED: HttpStatus.SERVICE_UNAVAILABLE,
  AI_PROVIDER_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  AI_TIMEOUT: HttpStatus.GATEWAY_TIMEOUT,
  AI_BAD_REQUEST: HttpStatus.BAD_GATEWAY,
  AI_REFUSED: HttpStatus.UNPROCESSABLE_ENTITY,
  AI_INVALID_OUTPUT: HttpStatus.BAD_GATEWAY,
  AI_ENCRYPTION_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  MARKETING_AI_BUDGET_EXCEEDED: HttpStatus.PAYMENT_REQUIRED,
  MARKETING_AI_DAILY_CAP_EXCEEDED: HttpStatus.PAYMENT_REQUIRED,
};

/** Transient provider problems: worth retrying later, not the caller's fault. */
export const TRANSIENT_AI_ERRORS: ReadonlySet<AiErrorCode> = new Set(['AI_RATE_LIMITED', 'AI_PROVIDER_UNAVAILABLE', 'AI_TIMEOUT']);

/** HTTP error with a stable `code` (see AI_ERROR_CODES in packages/shared). */
export class AiError extends HttpException {
  constructor(readonly code: AiErrorCode) {
    super({ statusCode: STATUS[code], message: apiErrorBaseMessageForCode(code) ?? code, code }, STATUS[code]);
  }
}
