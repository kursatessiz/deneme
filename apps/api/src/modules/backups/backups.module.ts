import { Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BackupHealthStatus } from '@platform/shared';
import { MessagingModule } from '../messaging/messaging.module';
import { BACKUP_STORE, DirectoryBackupLister, LOCAL_BACKUP_LISTER, createOffsiteStore } from './backup-store';
import { DATABASE_DUMPER, PgDumpDumper } from './pg-dumper';
import { BackupsService } from './backups.service';
import { BackupRunnerService } from './backup-runner.service';
import type { ScheduledBackupStep } from './backup-runner.service';
import { BackupsController } from './backups.controller';

export interface BackupsHeartbeatResult {
  scheduled: ScheduledBackupStep;
  status: BackupHealthStatus;
  staleAlertSent: boolean;
}

/** Heartbeat step (JobsService.runAll): the scheduled backup and the hourly stale check. */
@Injectable()
export class BackupsJobsService {
  constructor(
    private readonly backups: BackupsService,
    private readonly runner: BackupRunnerService,
  ) {}

  async run(now: Date): Promise<BackupsHeartbeatResult> {
    const scheduled = await this.runner.runScheduledIfDue(now);
    const stale = await this.backups.checkStaleIfDue(now);
    return { scheduled, status: stale.status, staleAlertSent: stale.alerted };
  }
}

/**
 * D2 database backups managed from the super admin panel (docs/YEDEKLER.md).
 * The store, the host directory lister and the dumper are injection tokens
 * so the e2e suite swaps in in-memory fakes.
 */
@Module({
  imports: [MessagingModule],
  controllers: [BackupsController],
  providers: [
    { provide: BACKUP_STORE, useFactory: createOffsiteStore, inject: [ConfigService] },
    {
      provide: LOCAL_BACKUP_LISTER,
      useFactory: (config: ConfigService) => new DirectoryBackupLister(config.get<string>('BACKUP_LOCAL_DIR')),
      inject: [ConfigService],
    },
    {
      provide: DATABASE_DUMPER,
      useFactory: (config: ConfigService) => new PgDumpDumper(config.getOrThrow<string>('DATABASE_URL'), config.get<string>('BACKUP_PG_DUMP_PATH') ?? 'pg_dump'),
      inject: [ConfigService],
    },
    BackupsService,
    BackupRunnerService,
    BackupsJobsService,
  ],
  exports: [BackupsService, BackupRunnerService, BackupsJobsService],
})
export class BackupsModule {}
