import { HttpException, HttpStatus } from '@nestjs/common';
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

/** Turkish fallback text; clients translate `code` with the ai.error.* keys instead. */
const MESSAGES: Record<AiErrorCode, string> = {
  AI_NOT_CONFIGURED: 'Yapay zeka yapılandırılmadı.',
  AI_MONTHLY_LIMIT_REACHED: 'Bu ayki yapay zeka kullanım limitine ulaşıldı.',
  AI_AUTH_FAILED: 'Yapay zeka sağlayıcısı API anahtarını kabul etmedi.',
  AI_RATE_LIMITED: 'Yapay zeka sağlayıcısı şu an yoğun.',
  AI_PROVIDER_UNAVAILABLE: 'Yapay zeka sağlayıcısına ulaşılamıyor.',
  AI_TIMEOUT: 'Yapay zeka yanıtı zaman aşımına uğradı.',
  AI_BAD_REQUEST: 'Yapay zeka isteği reddedildi.',
  AI_REFUSED: 'Yapay zeka bu isteği yanıtlamadı.',
  AI_INVALID_OUTPUT: 'Yapay zeka geçerli bir yanıt üretemedi.',
  AI_ENCRYPTION_UNAVAILABLE: 'Anahtar şifrelenemedi: INTEGRATION_ENCRYPTION_KEY tanımlı değil.',
  MARKETING_AI_BUDGET_EXCEEDED: 'Pazarlama yapay zeka bütçesi bu ay doldu.',
  MARKETING_AI_DAILY_CAP_EXCEEDED: 'Pazarlama yapay zeka günlük tavanı doldu.',
};

/** Transient provider problems: worth retrying later, not the caller's fault. */
export const TRANSIENT_AI_ERRORS: ReadonlySet<AiErrorCode> = new Set(['AI_RATE_LIMITED', 'AI_PROVIDER_UNAVAILABLE', 'AI_TIMEOUT']);

/** HTTP error with a stable `code` (see AI_ERROR_CODES in packages/shared). */
export class AiError extends HttpException {
  constructor(readonly code: AiErrorCode) {
    super({ statusCode: STATUS[code], message: MESSAGES[code], code }, STATUS[code]);
  }
}
