import { HttpException, HttpStatus } from '@nestjs/common';
import type { BackupErrorCode } from '@platform/shared';

const STATUS: Record<BackupErrorCode, HttpStatus> = {
  BACKUP_OFFSITE_NOT_CONFIGURED: HttpStatus.SERVICE_UNAVAILABLE,
  BACKUP_ALREADY_RUNNING: HttpStatus.CONFLICT,
  BACKUP_RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  BACKUP_NOT_FOUND: HttpStatus.NOT_FOUND,
  BACKUP_CONFIRM_MISMATCH: HttpStatus.BAD_REQUEST,
  BACKUP_NEWEST_VERIFIED_PROTECTED: HttpStatus.CONFLICT,
  BACKUP_LAST_COPY_PROTECTED: HttpStatus.CONFLICT,
  BACKUP_NOT_DOWNLOADABLE: HttpStatus.CONFLICT,
  BACKUP_STORE_ERROR: HttpStatus.BAD_GATEWAY,
};

/** Turkish fallback text; the panel translates `code` with adminBackups.error.* instead. */
const MESSAGES: Record<BackupErrorCode, string> = {
  BACKUP_OFFSITE_NOT_CONFIGURED: 'Uzak yedek deposu veya şifreleme anahtarı yapılandırılmadı.',
  BACKUP_ALREADY_RUNNING: 'Şu anda başka bir yedekleme sürüyor.',
  BACKUP_RATE_LIMITED: 'Kısa süre önce elle yedek alındı; biraz sonra tekrar deneyin.',
  BACKUP_NOT_FOUND: 'Yedek bulunamadı.',
  BACKUP_CONFIRM_MISMATCH: 'Onay için yazılan ad yedeğin adıyla aynı değil.',
  BACKUP_NEWEST_VERIFIED_PROTECTED: 'Doğrulanmış en yeni yedek silinemez.',
  BACKUP_LAST_COPY_PROTECTED: 'Uzak depodaki son yedek silinemez.',
  BACKUP_NOT_DOWNLOADABLE: 'Bu yedeğin uzak depoda şifreli bir kopyası yok.',
  BACKUP_STORE_ERROR: 'Uzak yedek deposuna ulaşılamadı.',
};

/** HTTP error with a stable `code` (BACKUP_ERROR_CODES in packages/shared). */
export class BackupError extends HttpException {
  constructor(readonly code: BackupErrorCode) {
    super({ statusCode: STATUS[code], message: MESSAGES[code], code }, STATUS[code]);
  }
}
