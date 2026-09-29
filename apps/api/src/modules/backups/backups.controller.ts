import { Controller, Get, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { BackupNameInputSchema, DeleteBackupSchema, UpdateBackupSettingsSchema } from '@platform/shared';
import type { BackupNameInput, DeleteBackupInput, UpdateBackupSettingsInput } from '@platform/shared';
import { SuperAdminOnly } from '../auth/decorators/super-admin-only.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/tenant-context';
import { ZodBody } from '../../common/zod-body.pipe';
import { BackupsService } from './backups.service';
import { BackupRunnerService } from './backup-runner.service';

/**
 * D2: the super admin's backup console (docs/YEDEKLER.md). Platform owner
 * only; every write is audit logged. Names go in the body (they contain
 * dots) and are validated against BACKUP_NAME_PATTERN.
 */
@Controller('admin/backups')
@SuperAdminOnly()
export class BackupsController {
  constructor(
    private readonly backups: BackupsService,
    private readonly runner: BackupRunnerService,
  ) {}

  @Get()
  overview() {
    return this.backups.overview();
  }

  @Post('run')
  @HttpCode(HttpStatus.ACCEPTED)
  run(@CurrentUser() user: AuthUser) {
    return this.runner.start('MANUAL', user.id);
  }

  @Put('settings')
  updateSettings(@CurrentUser() user: AuthUser, @ZodBody(UpdateBackupSettingsSchema) body: UpdateBackupSettingsInput) {
    return this.backups.updateSettings(user.id, body);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  verify(@CurrentUser() user: AuthUser, @ZodBody(BackupNameInputSchema) body: BackupNameInput) {
    return this.backups.verify(body.name, user.id);
  }

  @Post('download-url')
  @HttpCode(HttpStatus.OK)
  downloadUrl(@CurrentUser() user: AuthUser, @ZodBody(BackupNameInputSchema) body: BackupNameInput) {
    return this.backups.downloadUrl(body.name, user.id);
  }

  @Post('delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@CurrentUser() user: AuthUser, @ZodBody(DeleteBackupSchema) body: DeleteBackupInput) {
    await this.backups.delete(body.name, body.confirmName, user.id);
  }
}
