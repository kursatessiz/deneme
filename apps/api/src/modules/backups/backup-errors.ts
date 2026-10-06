import { HttpException, HttpStatus } from '@nestjs/common';
import { apiErrorBaseMessageForCode } from '@platform/shared';
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

/** HTTP error with a stable `code` (BACKUP_ERROR_CODES in packages/shared). */
export class BackupError extends HttpException {
  constructor(readonly code: BackupErrorCode) {
    super({ statusCode: STATUS[code], message: apiErrorBaseMessageForCode(code) ?? code, code }, STATUS[code]);
  }
}
