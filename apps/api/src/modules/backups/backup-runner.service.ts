import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { createGzip } from 'zlib';
import type { BackupRunDTO, BackupTrigger } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { BACKUP_STORE } from './backup-store';
import type { OffsiteBackupStore } from './backup-store';
import { DATABASE_DUMPER } from './pg-dumper';
import type { DatabaseDumper } from './pg-dumper';
import { createEncryptStream } from './backup-crypto';
import { BackupError } from './backup-errors';
import { SIDECAR_SUFFIX, buildBackupName, isScheduledBackupDue, objectKeyFor, planRetention } from './backup-policy';
import { BackupsService, SETTINGS_ID, runToDto } from './backups.service';

const MINUTE_MS = 60 * 1000;
/** A run (and its lock) older than this is considered dead: the process restarted mid-run. */
export const BACKUP_RUN_TIMEOUT_MS = 3 * 60 * MINUTE_MS;
/** Minimum gap between two manual runs ("run now" rate limit). */
export const MANUAL_RUN_COOLDOWN_MS = 10 * MINUTE_MS;

export interface ScheduledBackupStep {
  started: boolean;
  runId: string | null;
  reason: 'STARTED' | 'NOT_DUE' | 'DISABLED' | 'NOT_CONFIGURED' | 'ALREADY_RUNNING';
}

/**
 * Makes a backup inside the API: pg_dump -> gzip -> openssl-compatible
 * AES-256-CBC (PBKDF2) -> multipart upload, then the sha256 sidecar, a full
 * verification of the uploaded object and retention pruning. The same
 * artifact format and naming as deploy/scripts/backup.sh, marked "-api".
 *
 * Runs in-process in the background (the API is a single container; a
 * BullMQ job would add a Redis dependency to a feature whose purpose is
 * recovering from failures). One run at a time: the lock is a conditional
 * update of backup_settings.lock_run_id, so it holds across instances too.
 */
@Injectable()
export class BackupRunnerService {
  private readonly logger = new Logger(BackupRunnerService.name);
  private current: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly backups: BackupsService,
    @Inject(BACKUP_STORE) private readonly store: OffsiteBackupStore,
    @Inject(DATABASE_DUMPER) private readonly dumper: DatabaseDumper,
  ) {}

  /** Resolves when the in-process run (if any) has finished. For tests and shutdown. */
  async waitForIdle(): Promise<void> {
    while (this.current) await this.current;
  }

  /** Marks runs that outlived the timeout as failed and frees an abandoned lock. */
  private async reconcile(now: Date): Promise<void> {
    const cutoff = new Date(now.getTime() - BACKUP_RUN_TIMEOUT_MS);
    await this.prisma.backupRun.updateMany({
      where: { status: 'RUNNING', startedAt: { lt: cutoff } },
      data: { status: 'FAILED', finishedAt: now, error: 'interrupted (no progress within the run timeout)' },
    });
  }

  async start(trigger: BackupTrigger, userId: string | null, now = new Date()): Promise<BackupRunDTO> {
    if (!this.backups.offsiteReady) throw new BackupError('BACKUP_OFFSITE_NOT_CONFIGURED');
    if (trigger === 'MANUAL') {
      const recent = await this.prisma.backupRun.findFirst({
        where: { trigger: 'MANUAL', startedAt: { gt: new Date(now.getTime() - MANUAL_RUN_COOLDOWN_MS) } },
        select: { id: true },
      });
      if (recent) throw new BackupError('BACKUP_RATE_LIMITED');
    }
    await this.reconcile(now);
    await this.backups.getSettingsRow();

    const id = randomUUID();
    const locked = await this.prisma.backupSettings.updateMany({
      where: { id: SETTINGS_ID, OR: [{ lockRunId: null }, { lockedAt: { lt: new Date(now.getTime() - BACKUP_RUN_TIMEOUT_MS) } }] },
      data: { lockRunId: id, lockedAt: now },
    });
    if (locked.count === 0) throw new BackupError('BACKUP_ALREADY_RUNNING');

    let run;
    try {
      run = await this.prisma.backupRun.create({ data: { id, trigger, status: 'RUNNING', startedAt: now, requestedByUserId: userId } });
      await this.backups.audit(userId, 'backup.run_started', 'BackupRun', id, { trigger });
    } catch (err) {
      await this.releaseLock(id);
      throw err;
    }

    const task: Promise<void> = this.execute(id, now).finally(async () => {
      await this.releaseLock(id);
      if (this.current === task) this.current = null;
    });
    this.current = task;
    return runToDto(run);
  }

  private async releaseLock(runId: string): Promise<void> {
    await this.prisma.backupSettings
      .updateMany({ where: { id: SETTINGS_ID, lockRunId: runId }, data: { lockRunId: null, lockedAt: null } })
      .catch((err: unknown) => this.logger.error(`Releasing the backup lock failed: ${err instanceof Error ? err.message : 'unknown'}`));
  }

  private async execute(runId: string, startedAt: Date): Promise<void> {
    const info = this.store.info;
    const name = buildBackupName(startedAt, 'api');
    const key = objectKeyFor(name, info?.prefix ?? '');
    const hash = createHash('sha256');
    let uploaded = false;
    try {
      const dump = this.dumper.dump();
      const encrypt = await createEncryptStream(this.backups.encryptionKey ?? '');
      const tap = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          hash.update(chunk);
          cb(null, chunk);
        },
      });
      let sizeBytes = 0;
      try {
        await pipeline(dump.stdout, createGzip({ level: 6 }), encrypt, tap, async (source: AsyncIterable<Buffer>) => {
          sizeBytes = await this.store.upload(key, Readable.from(source));
        });
        uploaded = true;
        await dump.done;
      } catch (err) {
        dump.kill();
        await dump.done.catch(() => undefined);
        throw err;
      }
      const sha256 = hash.digest('hex');
      await this.store.putText(`${key}${SIDECAR_SUFFIX}`, `${sha256}\n`);
      await this.prisma.backupRun.update({ where: { id: runId }, data: { sizeBytes: BigInt(sizeBytes), objectKey: key, sha256 } });

      const check = await this.backups.verifyObject(name, key, null);
      if (!check.ok) throw new Error(`verification failed: ${check.failure}`);
      const finishedAt = new Date();
      await this.prisma.backupRun.update({ where: { id: runId }, data: { status: 'SUCCEEDED', finishedAt, verifiedAt: finishedAt } });
      await this.backups.audit(null, 'backup.run_succeeded', 'BackupRun', runId, { name, key, sizeBytes, sha256 });
      this.backups.invalidateStatus();
      this.logger.log(`Backup ${name} uploaded and verified (${sizeBytes} bytes)`);
      await this.prune(new Date()).catch((err: unknown) =>
        this.logger.error(`Backup retention failed: ${err instanceof Error ? err.message : 'unknown'}`),
      );
    } catch (err) {
      const message = (err instanceof Error ? err.message : 'unknown error').slice(0, 1000);
      this.logger.error(`Backup run ${runId} failed: ${message}`);
      if (uploaded) {
        // An incomplete or unverifiable object must not look like a good backup.
        await this.store.delete(key).catch(() => undefined);
        await this.store.delete(`${key}${SIDECAR_SUFFIX}`).catch(() => undefined);
      }
      await this.prisma.backupRun
        .update({ where: { id: runId }, data: { status: 'FAILED', finishedAt: new Date(), error: message } })
        .catch(() => undefined);
      await this.backups.audit(null, 'backup.run_failed', 'BackupRun', runId, { name, error: message }).catch(() => undefined);
    }
  }

  /**
   * Deletes off-site backups older than the retention setting. Never runs
   * unless the newest backup is verified and never deletes the newest
   * verified one (planRetention). Audit logged either way.
   */
  async prune(now = new Date()): Promise<{ deleted: string[]; skipped: string | null }> {
    const settings = await this.backups.getSettingsRow();
    const inv = await this.backups.inventory();
    if (inv.errors.offsite) return { deleted: [], skipped: 'STORE_ERROR' };
    const verified = BackupsService.verifiedSet(await this.backups.verifications(inv.offsite.map((o) => o.name)));
    const plan = planRetention(
      inv.offsite.map((o) => ({ name: o.name, createdAt: o.lastModified })),
      verified,
      now,
      settings.retentionDays,
    );
    if (plan.skipped === 'DISABLED') return { deleted: [], skipped: plan.skipped };
    if (plan.skipped) {
      await this.backups.audit(null, 'backup.prune_skipped', 'BackupRetention', now.toISOString().slice(0, 10), { reason: plan.skipped });
      return { deleted: [], skipped: plan.skipped };
    }
    const deleted: string[] = [];
    for (const name of plan.delete) {
      const target = inv.offsite.find((o) => o.name === name)!;
      try {
        await this.backups.removeObject(target);
        deleted.push(name);
      } catch {
        // Logged in removeObject; the next run retries.
      }
    }
    if (deleted.length > 0) {
      await this.backups.audit(null, 'backup.pruned', 'BackupRetention', now.toISOString().slice(0, 10), {
        deleted,
        retentionDays: settings.retentionDays,
        newestVerified: plan.newestVerified,
      });
      this.backups.invalidateStatus();
    }
    return { deleted, skipped: null };
  }

  /** Heartbeat step: starts the daily scheduled backup when its UTC slot has passed. */
  async runScheduledIfDue(now = new Date()): Promise<ScheduledBackupStep> {
    if (!this.backups.offsiteReady) return { started: false, runId: null, reason: 'NOT_CONFIGURED' };
    const settings = await this.backups.getSettingsRow();
    if (!settings.scheduleEnabled) return { started: false, runId: null, reason: 'DISABLED' };
    const last = await this.prisma.backupRun.findFirst({ where: { trigger: 'SCHEDULED' }, orderBy: { startedAt: 'desc' }, select: { startedAt: true } });
    if (!isScheduledBackupDue(now, settings.scheduleTimeUtc, last?.startedAt ?? null)) return { started: false, runId: null, reason: 'NOT_DUE' };
    try {
      const run = await this.start('SCHEDULED', null, now);
      return { started: true, runId: run.id, reason: 'STARTED' };
    } catch (err) {
      if (err instanceof BackupError && err.code === 'BACKUP_ALREADY_RUNNING') return { started: false, runId: null, reason: 'ALREADY_RUNNING' };
      throw err;
    }
  }
}
