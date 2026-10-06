import { z } from 'zod';
import { vmsg } from './validation-key';

/**
 * D2 database backups managed from the super admin panel (docs/YEDEKLER.md).
 * The API and the host cron (deploy/scripts/backup.sh) write the same
 * artifact format to the same off-site bucket and prefix; the file name
 * marks which of the two made it.
 */

export const BACKUP_RUN_STATUSES = ['RUNNING', 'SUCCEEDED', 'FAILED'] as const;
export type BackupRunStatus = (typeof BACKUP_RUN_STATUSES)[number];

export const BACKUP_TRIGGERS = ['MANUAL', 'SCHEDULED'] as const;
export type BackupTrigger = (typeof BACKUP_TRIGGERS)[number];

/** Who wrote a file: the host cron (`-host`), the API (`-api`), or an older host script without a marker. */
export const BACKUP_ORIGINS = ['host', 'api', 'legacy'] as const;
export type BackupOrigin = (typeof BACKUP_ORIGINS)[number];

export const BACKUP_LOCATIONS = ['local', 'offsite', 'both'] as const;
export type BackupLocation = (typeof BACKUP_LOCATIONS)[number];

export const BACKUP_HEALTH_STATUSES = ['ok', 'stale', 'not_configured', 'error'] as const;
export type BackupHealthStatus = (typeof BACKUP_HEALTH_STATUSES)[number];

/** Stable error codes; clients translate them with `adminBackups.error.<code>`. */
export const BACKUP_ERROR_CODES = [
  'BACKUP_OFFSITE_NOT_CONFIGURED',
  'BACKUP_ALREADY_RUNNING',
  'BACKUP_RATE_LIMITED',
  'BACKUP_NOT_FOUND',
  'BACKUP_CONFIRM_MISMATCH',
  'BACKUP_NEWEST_VERIFIED_PROTECTED',
  'BACKUP_LAST_COPY_PROTECTED',
  'BACKUP_NOT_DOWNLOADABLE',
  'BACKUP_STORE_ERROR',
] as const;
export type BackupErrorCode = (typeof BACKUP_ERROR_CODES)[number];

export function isBackupErrorCode(value: unknown): value is BackupErrorCode {
  return typeof value === 'string' && (BACKUP_ERROR_CODES as readonly string[]).includes(value);
}

/** Built-in email template sent to super admins when no backup succeeded for too long. */
export const BACKUP_STALE_TEMPLATE_KEY = 'BACKUP_STALE';

/**
 * Backup file name without the `.enc` suffix, as both writers produce it:
 * `db_YYYYMMDD_HHMMSSZ-host.sql.gz`, `db_YYYYMMDD_HHMMSSZ-api.sql.gz`, or the
 * older host form `db_YYYYMMDD_HHMMSS.sql.gz` (server local time, no marker).
 */
export const BACKUP_NAME_PATTERN = /^db_\d{8}_\d{6}Z?(?:-(?:host|api))?\.sql\.gz$/;

const BackupNameSchema = z.string().trim().regex(BACKUP_NAME_PATTERN, vmsg('validation.invalidBackupName'));

/** "HH:MM", 24-hour, UTC. */
export const BACKUP_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const UpdateBackupSettingsSchema = z
  .object({
    scheduleEnabled: z.boolean(),
    scheduleTimeUtc: z.string().regex(BACKUP_TIME_PATTERN, vmsg('validation.timeInHhMmFormat')),
    /** Off-site objects older than this many days are pruned after a verified backup; 0 turns pruning off. */
    retentionDays: z.number().int().min(0).max(3650),
  })
  .strict()
  .refine((v) => v.retentionDays === 0 || v.retentionDays >= 7, {
    message: vmsg('validation.retention0OffOrLeast7'),
    path: ['retentionDays'],
  });
export type UpdateBackupSettingsInput = z.infer<typeof UpdateBackupSettingsSchema>;

export const BackupNameInputSchema = z.object({ name: BackupNameSchema }).strict();
export type BackupNameInput = z.infer<typeof BackupNameInputSchema>;

export const DeleteBackupSchema = z
  .object({
    name: BackupNameSchema,
    /** The operator types the backup name again; it must match exactly. */
    confirmName: z.string().trim().min(1).max(100),
  })
  .strict();
export type DeleteBackupInput = z.infer<typeof DeleteBackupSchema>;

export interface BackupEntryDTO {
  /** File name without `.enc`, the same for the local and the off-site copy. */
  name: string;
  origin: BackupOrigin;
  location: BackupLocation;
  /** Best known creation time: the off-site LastModified, else the local file time. */
  createdAt: string;
  ageHours: number;
  /** Encrypted off-site size, else the local (gzip) size. */
  sizeBytes: number;
  offsiteKey: string | null;
  localSizeBytes: number | null;
  offsiteSizeBytes: number | null;
  sha256SidecarPresent: boolean;
  /** Last successful verification (sha256 and full test decryption), if any. */
  verifiedAt: string | null;
  /** True for the newest verified off-site backup: it cannot be deleted or pruned. */
  protected: boolean;
}

export interface BackupRunDTO {
  id: string;
  status: BackupRunStatus;
  trigger: BackupTrigger;
  startedAt: string;
  finishedAt: string | null;
  sizeBytes: number | null;
  objectKey: string | null;
  verifiedAt: string | null;
  error: string | null;
  requestedByUserId: string | null;
}

export interface BackupSettingsDTO {
  scheduleEnabled: boolean;
  scheduleTimeUtc: string;
  retentionDays: number;
  updatedAt: string | null;
  /** Next time the heartbeat starts a scheduled backup (null when off or not configured). */
  nextScheduledAt: string | null;
}

export interface BackupStatusDTO {
  status: BackupHealthStatus;
  lastSuccessAt: string | null;
  hoursSinceLastSuccess: number | null;
  staleAfterHours: number;
  checkedAt: string;
  offsiteConfigured: boolean;
  localConfigured: boolean;
  /** Present when listing the store failed; never contains credentials. */
  errorMessage?: string;
}

export interface BackupSummaryDTO {
  status: BackupStatusDTO;
  offsiteCount: number;
  offsiteTotalBytes: number;
  localCount: number;
  localTotalBytes: number;
}

export interface BackupConfigDTO {
  offsiteConfigured: boolean;
  localConfigured: boolean;
  /** Bucket, prefix and endpoint host only; keys and secrets are never returned. */
  bucket: string | null;
  prefix: string | null;
  endpointHost: string | null;
  downloadUrlTtlSeconds: number;
}

export interface BackupOverviewDTO {
  config: BackupConfigDTO;
  settings: BackupSettingsDTO;
  summary: BackupSummaryDTO;
  entries: BackupEntryDTO[];
  runs: BackupRunDTO[];
  /** Listing problems per location (the page still shows what it could read). */
  errors: { offsite: string | null; local: string | null };
}

export interface BackupVerifyResultDTO {
  name: string;
  ok: boolean;
  sha256: string;
  sidecarSha256: string | null;
  sizeBytes: number;
  /** Uncompressed SQL bytes read during the test decryption. */
  sqlBytes: number;
  failure: 'SHA256_MISMATCH' | 'SIDECAR_MISSING' | 'DECRYPT_FAILED' | 'NOT_A_DUMP' | null;
  verifiedAt: string;
}

export interface BackupDownloadDTO {
  url: string;
  expiresAt: string;
}
