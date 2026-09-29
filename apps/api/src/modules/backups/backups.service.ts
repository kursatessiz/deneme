import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BACKUP_STALE_TEMPLATE_KEY } from '@platform/shared';
import type {
  BackupDownloadDTO,
  BackupEntryDTO,
  BackupOverviewDTO,
  BackupRunDTO,
  BackupSettingsDTO,
  BackupStatusDTO,
  BackupVerifyResultDTO,
  UpdateBackupSettingsInput,
} from '@platform/shared';
import type { BackupRun, BackupSettings } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingService } from '../messaging/engine/messaging.service';
import { BACKUP_STORE, LOCAL_BACKUP_LISTER } from './backup-store';
import type { LocalBackupFile, LocalBackupLister, OffsiteBackupStore, StoredObject } from './backup-store';
import { BackupError } from './backup-errors';
import { SIDECAR_SUFFIX, hoursSince, isStale, nameFromObjectKey, newestVerified, nextSlot, parseBackupName } from './backup-policy';
import { parseSidecar, verifyEncryptedStream } from './backup-verify';

const HOUR_MS = 60 * 60 * 1000;
const STATUS_CACHE_MS = 5 * 60 * 1000;
const STALE_ALERT_INTERVAL_MS = 24 * HOUR_MS;
const RUNS_SHOWN = 20;
export const SETTINGS_ID = 'platform';

export interface OffsiteBackup {
  name: string;
  key: string;
  size: number;
  lastModified: Date;
  hasSidecar: boolean;
}

export interface Inventory {
  offsite: OffsiteBackup[];
  local: LocalBackupFile[];
  errors: { offsite: string | null; local: string | null };
}

export function runToDto(run: BackupRun): BackupRunDTO {
  return {
    id: run.id,
    status: run.status,
    trigger: run.trigger,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    sizeBytes: run.sizeBytes === null ? null : Number(run.sizeBytes),
    objectKey: run.objectKey,
    verifiedAt: run.verifiedAt?.toISOString() ?? null,
    error: run.error,
    requestedByUserId: run.requestedByUserId,
  };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message.slice(0, 300) : 'unknown error';
}

/**
 * D2 backups: what exists (off-site bucket and the host directory), their
 * health, verification, presigned download and guarded deletion. Starting
 * a backup is BackupRunnerService. Every write is audit logged; no method
 * ever returns the encryption key or the storage secret.
 */
@Injectable()
export class BackupsService {
  private readonly logger = new Logger(BackupsService.name);
  private cachedStatus: { at: number; value: BackupStatusDTO } | null = null;
  private lastStaleCheckAt: number | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly messaging: MessagingService,
    @Inject(BACKUP_STORE) private readonly store: OffsiteBackupStore,
    @Inject(LOCAL_BACKUP_LISTER) private readonly local: LocalBackupLister,
  ) {}

  get offsiteReady(): boolean {
    return this.store.configured && Boolean(this.encryptionKey);
  }

  get encryptionKey(): string | undefined {
    return this.config.get<string>('BACKUP_ENCRYPTION_KEY');
  }

  get staleAfterHours(): number {
    return this.config.get<number>('BACKUP_STALE_HOURS') ?? 26;
  }

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  async getSettingsRow(): Promise<BackupSettings> {
    return this.prisma.backupSettings.upsert({ where: { id: SETTINGS_ID }, create: { id: SETTINGS_ID }, update: {} });
  }

  settingsToDto(row: BackupSettings, now = new Date()): BackupSettingsDTO {
    return {
      scheduleEnabled: row.scheduleEnabled,
      scheduleTimeUtc: row.scheduleTimeUtc,
      retentionDays: row.retentionDays,
      updatedAt: row.updatedByUserId ? row.updatedAt.toISOString() : null,
      nextScheduledAt: row.scheduleEnabled && this.offsiteReady ? nextSlot(now, row.scheduleTimeUtc).toISOString() : null,
    };
  }

  async updateSettings(userId: string, input: UpdateBackupSettingsInput): Promise<BackupSettingsDTO> {
    const before = await this.getSettingsRow();
    const row = await this.prisma.backupSettings.update({
      where: { id: SETTINGS_ID },
      data: { scheduleEnabled: input.scheduleEnabled, scheduleTimeUtc: input.scheduleTimeUtc, retentionDays: input.retentionDays, updatedByUserId: userId },
    });
    await this.audit(userId, 'backup.settings_updated', 'BackupSettings', SETTINGS_ID, {
      before: { scheduleEnabled: before.scheduleEnabled, scheduleTimeUtc: before.scheduleTimeUtc, retentionDays: before.retentionDays },
      after: input,
    });
    return this.settingsToDto(row);
  }

  // -------------------------------------------------------------------------
  // Inventory
  // -------------------------------------------------------------------------

  async inventory(): Promise<Inventory> {
    const errors: Inventory['errors'] = { offsite: null, local: null };
    let objects: StoredObject[] = [];
    if (this.store.configured) {
      try {
        objects = await this.store.list();
      } catch (err) {
        errors.offsite = errorText(err);
        this.logger.warn(`Listing off-site backups failed: ${errors.offsite}`);
      }
    }
    let local: LocalBackupFile[] = [];
    if (this.local.configured) {
      try {
        local = (await this.local.list()).filter((f) => parseBackupName(f.name));
      } catch (err) {
        errors.local = errorText(err);
        this.logger.warn(`Listing local backups failed: ${errors.local}`);
      }
    }
    const prefix = this.store.info?.prefix ?? '';
    const keys = new Set(objects.map((o) => o.key));
    const offsite: OffsiteBackup[] = [];
    for (const o of objects) {
      const name = nameFromObjectKey(o.key, prefix);
      if (!name) continue;
      offsite.push({ name, key: o.key, size: o.size, lastModified: o.lastModified, hasSidecar: keys.has(`${o.key}${SIDECAR_SUFFIX}`) });
    }
    return { offsite, local, errors };
  }

  /** Latest verification outcome per backup name (from the audit log). */
  async verifications(names: string[]): Promise<Map<string, { ok: boolean; at: Date }>> {
    const out = new Map<string, { ok: boolean; at: Date }>();
    if (names.length === 0) return out;
    const rows = await this.prisma.auditLog.findMany({
      where: { entityType: 'Backup', action: { in: ['backup.verified', 'backup.verify_failed'] }, entityId: { in: names } },
      orderBy: { createdAt: 'desc' },
      select: { entityId: true, action: true, createdAt: true },
    });
    for (const r of rows) {
      if (r.entityId && !out.has(r.entityId)) out.set(r.entityId, { ok: r.action === 'backup.verified', at: r.createdAt });
    }
    return out;
  }

  static verifiedSet(v: Map<string, { ok: boolean }>): Set<string> {
    return new Set([...v].filter(([, x]) => x.ok).map(([n]) => n));
  }

  async overview(now = new Date()): Promise<BackupOverviewDTO> {
    const [inv, settingsRow, runs] = await Promise.all([
      this.inventory(),
      this.getSettingsRow(),
      this.prisma.backupRun.findMany({ orderBy: { startedAt: 'desc' }, take: RUNS_SHOWN }),
    ]);
    const names = [...new Set([...inv.offsite.map((o) => o.name), ...inv.local.map((l) => l.name)])];
    const verif = await this.verifications(names);
    const verified = BackupsService.verifiedSet(verif);
    const protectedName = newestVerified(
      inv.offsite.map((o) => ({ name: o.name, createdAt: o.lastModified })),
      verified,
    );

    const entries: BackupEntryDTO[] = names.map((name) => {
      const off = inv.offsite.find((o) => o.name === name) ?? null;
      const loc = inv.local.find((l) => l.name === name) ?? null;
      const createdAt = off?.lastModified ?? loc!.modifiedAt;
      const v = verif.get(name);
      return {
        name,
        origin: parseBackupName(name)?.origin ?? 'legacy',
        location: off && loc ? 'both' : off ? 'offsite' : 'local',
        createdAt: createdAt.toISOString(),
        ageHours: hoursSince(createdAt, now) ?? 0,
        sizeBytes: off?.size ?? loc!.size,
        offsiteKey: off?.key ?? null,
        localSizeBytes: loc?.size ?? null,
        offsiteSizeBytes: off?.size ?? null,
        sha256SidecarPresent: off?.hasSidecar ?? false,
        verifiedAt: v?.ok ? v.at.toISOString() : null,
        protected: name === protectedName,
      };
    });
    entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const status = this.computeStatus(inv, runs, now);
    this.cachedStatus = { at: now.getTime(), value: status };
    const info = this.store.info;
    return {
      config: {
        offsiteConfigured: this.offsiteReady,
        localConfigured: this.local.configured,
        bucket: info?.bucket ?? null,
        prefix: info?.prefix ?? null,
        endpointHost: info?.endpointHost ?? null,
        downloadUrlTtlSeconds: this.downloadTtl,
      },
      settings: this.settingsToDto(settingsRow, now),
      summary: {
        status,
        offsiteCount: inv.offsite.length,
        offsiteTotalBytes: inv.offsite.reduce((s, o) => s + o.size, 0),
        localCount: inv.local.length,
        localTotalBytes: inv.local.reduce((s, l) => s + l.size, 0),
      },
      entries,
      runs: runs.map(runToDto),
      errors: inv.errors,
    };
  }

  // -------------------------------------------------------------------------
  // Status and stale alert
  // -------------------------------------------------------------------------

  /**
   * Last success: with an off-site store, the newest off-site object that
   * has its sha256 sidecar (a local-only file means the upload failed);
   * without one, the newest local file. A succeeded API run counts too.
   */
  private computeStatus(inv: Inventory, runs: BackupRun[], now: Date): BackupStatusDTO {
    const offsiteConfigured = this.store.configured;
    const localConfigured = this.local.configured;
    const base = { staleAfterHours: this.staleAfterHours, checkedAt: now.toISOString(), offsiteConfigured, localConfigured };
    if (!offsiteConfigured && !localConfigured) {
      return { ...base, status: 'not_configured', lastSuccessAt: null, hoursSinceLastSuccess: null };
    }
    const times: number[] = [];
    if (offsiteConfigured) times.push(...inv.offsite.filter((o) => o.hasSidecar).map((o) => o.lastModified.getTime()));
    else times.push(...inv.local.map((l) => l.modifiedAt.getTime()));
    times.push(...runs.filter((r) => r.status === 'SUCCEEDED' && r.finishedAt).map((r) => r.finishedAt!.getTime()));
    const last = times.length > 0 ? new Date(Math.max(...times)) : null;
    const listingError = offsiteConfigured ? inv.errors.offsite : inv.errors.local;
    const status: BackupStatusDTO['status'] = listingError ? 'error' : isStale(last, now, this.staleAfterHours) ? 'stale' : 'ok';
    return {
      ...base,
      status,
      lastSuccessAt: last?.toISOString() ?? null,
      hoursSinceLastSuccess: hoursSince(last, now),
      ...(listingError ? { errorMessage: listingError } : {}),
    };
  }

  async getStatus(now = new Date(), maxAgeMs = STATUS_CACHE_MS): Promise<BackupStatusDTO> {
    if (this.cachedStatus && now.getTime() - this.cachedStatus.at < maxAgeMs && now.getTime() >= this.cachedStatus.at) {
      return this.cachedStatus.value;
    }
    const [inv, runs] = await Promise.all([
      this.inventory(),
      this.prisma.backupRun.findMany({ where: { status: 'SUCCEEDED' }, orderBy: { finishedAt: 'desc' }, take: 1 }),
    ]);
    const value = this.computeStatus(inv, runs, now);
    this.cachedStatus = { at: now.getTime(), value };
    return value;
  }

  /**
   * Heartbeat step, at most hourly: when no backup succeeded within
   * BACKUP_STALE_HOURS, email the super admins, at most once a day.
   */
  async checkStaleIfDue(now = new Date(), force = false): Promise<{ status: BackupStatusDTO['status']; alerted: boolean }> {
    if (!force && this.lastStaleCheckAt !== null && Math.abs(now.getTime() - this.lastStaleCheckAt) < HOUR_MS) {
      return { status: this.cachedStatus?.value.status ?? 'not_configured', alerted: false };
    }
    this.lastStaleCheckAt = now.getTime();
    const status = await this.getStatus(now, 0);
    if (status.status !== 'stale') return { status: status.status, alerted: false };
    // The alert time is kept in the metadata so the once-a-day rule follows the same clock as `now`.
    const previous = await this.prisma.auditLog.findFirst({
      where: { action: 'backup.stale_alert_sent' },
      orderBy: { createdAt: 'desc' },
      select: { metadata: true },
    });
    const previousAt = Date.parse(String((previous?.metadata as { alertedAt?: unknown } | null)?.alertedAt ?? ''));
    if (!Number.isNaN(previousAt) && Math.abs(now.getTime() - previousAt) < STALE_ALERT_INTERVAL_MS) return { status: status.status, alerted: false };
    this.logger.warn(`No successful backup for ${status.hoursSinceLastSuccess ?? 'ever'} hours (threshold ${status.staleAfterHours})`);
    const recipients = await this.sendToSuperAdmins({
      hours: status.hoursSinceLastSuccess === null ? '-' : Math.floor(status.hoursSinceLastSuccess),
      lastSuccessAt: status.lastSuccessAt ?? '-',
      threshold: status.staleAfterHours,
      link: `${(this.config.get<string>('PUBLIC_APP_URL') ?? 'http://localhost:3000').replace(/\/+$/, '')}/admin/yedekler`,
    });
    await this.audit(null, 'backup.stale_alert_sent', 'BackupStatus', now.toISOString().slice(0, 10), {
      alertedAt: now.toISOString(),
      lastSuccessAt: status.lastSuccessAt,
      hoursSinceLastSuccess: status.hoursSinceLastSuccess,
      threshold: status.staleAfterHours,
      recipients,
    });
    return { status: status.status, alerted: true };
  }

  private async sendToSuperAdmins(variables: Record<string, string | number>): Promise<number> {
    const admins = await this.prisma.user.findMany({ where: { isSuperAdmin: true, isActive: true, email: { not: null } }, select: { id: true } });
    let accepted = 0;
    for (const admin of admins) {
      try {
        const result = await this.messaging.send({
          studioId: null,
          recipient: { userId: admin.id },
          channel: 'EMAIL',
          purpose: 'TRANSACTIONAL',
          templateKey: BACKUP_STALE_TEMPLATE_KEY,
          variables,
          type: BACKUP_STALE_TEMPLATE_KEY,
          billing: 'EXEMPT',
        });
        if (result.success) accepted++;
      } catch (err) {
        this.logger.warn(`Backup alert could not be sent: ${err instanceof Error ? err.name : 'unknown'}`);
      }
    }
    return accepted;
  }

  // -------------------------------------------------------------------------
  // Actions on one backup
  // -------------------------------------------------------------------------

  private get downloadTtl(): number {
    return this.config.get<number>('BACKUP_DOWNLOAD_URL_TTL_SECONDS') ?? 300;
  }

  private requireOffsite(): void {
    if (!this.offsiteReady) throw new BackupError('BACKUP_OFFSITE_NOT_CONFIGURED');
  }

  private async offsiteList(): Promise<OffsiteBackup[]> {
    const inv = await this.inventory();
    if (inv.errors.offsite) throw new BackupError('BACKUP_STORE_ERROR');
    return inv.offsite;
  }

  private async findOffsite(name: string): Promise<{ target: OffsiteBackup; all: OffsiteBackup[] }> {
    const all = await this.offsiteList();
    const target = all.find((o) => o.name === name);
    if (!target) {
      const localHit = this.local.configured && (await this.local.list().catch((): LocalBackupFile[] => [])).some((l) => l.name === name);
      throw new BackupError(localHit ? 'BACKUP_NOT_DOWNLOADABLE' : 'BACKUP_NOT_FOUND');
    }
    return { target, all };
  }

  /** Downloads, hashes and fully test-decrypts one off-site backup; the result is audit logged. */
  async verify(name: string, userId: string | null, now = new Date()): Promise<BackupVerifyResultDTO> {
    this.requireOffsite();
    const { target } = await this.findOffsite(name);
    return this.verifyObject(target.name, target.key, userId, now);
  }

  async verifyObject(name: string, key: string, userId: string | null, now = new Date()): Promise<BackupVerifyResultDTO> {
    let result: Awaited<ReturnType<typeof verifyEncryptedStream>>;
    let sidecar: string | null;
    try {
      sidecar = parseSidecar(await this.store.getText(`${key}${SIDECAR_SUFFIX}`));
      result = await verifyEncryptedStream(await this.store.getStream(key), this.encryptionKey ?? '', sidecar);
    } catch (err) {
      this.logger.warn(`Verifying ${name} failed: ${errorText(err)}`);
      throw new BackupError('BACKUP_STORE_ERROR');
    }
    const failure = sidecar === null && !result.failure ? 'SIDECAR_MISSING' : result.failure;
    const ok = failure === null;
    await this.audit(userId, ok ? 'backup.verified' : 'backup.verify_failed', 'Backup', name, {
      key,
      sha256: result.sha256,
      sidecarSha256: sidecar,
      sizeBytes: result.sizeBytes,
      sqlBytes: result.sqlBytes,
      failure,
    });
    return { name, ok, sha256: result.sha256, sidecarSha256: sidecar, sizeBytes: result.sizeBytes, sqlBytes: result.sqlBytes, failure, verifiedAt: now.toISOString() };
  }

  /** Short-lived presigned GET for the encrypted object; the key never leaves the server. */
  async downloadUrl(name: string, userId: string, now = new Date()): Promise<BackupDownloadDTO> {
    this.requireOffsite();
    const { target } = await this.findOffsite(name);
    const ttl = this.downloadTtl;
    const url = this.store.presignGet(target.key, ttl);
    await this.audit(userId, 'backup.download_url_created', 'Backup', name, { key: target.key, ttlSeconds: ttl });
    return { url, expiresAt: new Date(now.getTime() + ttl * 1000).toISOString() };
  }

  /** Deletes an off-site backup and its sidecar. Refuses the newest verified backup and the last copy. */
  async delete(name: string, confirmName: string, userId: string): Promise<void> {
    if (confirmName.trim() !== name) throw new BackupError('BACKUP_CONFIRM_MISMATCH');
    this.requireOffsite();
    const { target, all } = await this.findOffsite(name);
    if (all.length <= 1) throw new BackupError('BACKUP_LAST_COPY_PROTECTED');
    const verified = BackupsService.verifiedSet(await this.verifications(all.map((o) => o.name)));
    const protectedName = newestVerified(
      all.map((o) => ({ name: o.name, createdAt: o.lastModified })),
      verified,
    );
    if (protectedName === name) throw new BackupError('BACKUP_NEWEST_VERIFIED_PROTECTED');
    await this.removeObject(target);
    await this.audit(userId, 'backup.deleted', 'Backup', name, { key: target.key, sizeBytes: target.size });
    this.cachedStatus = null;
  }

  async removeObject(target: OffsiteBackup): Promise<void> {
    try {
      await this.store.delete(target.key);
      if (target.hasSidecar) await this.store.delete(`${target.key}${SIDECAR_SUFFIX}`);
    } catch (err) {
      this.logger.warn(`Deleting ${target.name} failed: ${errorText(err)}`);
      throw new BackupError('BACKUP_STORE_ERROR');
    }
  }

  invalidateStatus(): void {
    this.cachedStatus = null;
  }

  async audit(userId: string | null, action: string, entityType: string, entityId: string, metadata: Record<string, unknown>): Promise<void> {
    await this.prisma.auditLog.create({
      data: { studioId: null, userId, action, entityType, entityId: entityId.slice(0, 60), metadata: metadata as object },
    });
  }
}
