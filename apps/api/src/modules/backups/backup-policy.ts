import { BACKUP_NAME_PATTERN, BACKUP_TIME_PATTERN } from '@platform/shared';
import type { BackupOrigin } from '@platform/shared';

/**
 * Pure backup rules (names, schedule, retention), kept free of I/O so the
 * spec covers them directly. docs/YEDEKLER.md describes the same rules.
 */

export const ENCRYPTED_SUFFIX = '.enc';
export const SIDECAR_SUFFIX = '.sha256';
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** "db_20261018_010000Z-api.sql.gz": UTC stamp with a Z and the writer's marker. */
export function buildBackupName(startedAt: Date, origin: 'api' | 'host'): string {
  const iso = startedAt.toISOString(); // 2026-10-18T01:00:00.000Z
  const stamp = `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}_${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
  return `db_${stamp}-${origin}.sql.gz`;
}

export interface ParsedBackupName {
  name: string;
  origin: BackupOrigin;
  /** Only for UTC (Z) stamps; the older host names are server local time and are not trusted. */
  stampUtc: Date | null;
}

export function parseBackupName(name: string): ParsedBackupName | null {
  if (!BACKUP_NAME_PATTERN.test(name)) return null;
  const m = /^db_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})(Z?)(?:-(host|api))?\.sql\.gz$/.exec(name);
  if (!m) return null;
  const origin: BackupOrigin = m[8] === 'api' ? 'api' : m[8] === 'host' ? 'host' : 'legacy';
  const stampUtc = m[7] === 'Z' ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null;
  return { name, origin, stampUtc: stampUtc && !Number.isNaN(stampUtc.getTime()) ? stampUtc : null };
}

/** Off-site object key -> backup name, or null for sidecars and foreign objects. */
export function nameFromObjectKey(key: string, prefix: string): string | null {
  const base = prefix ? (key.startsWith(`${prefix}/`) ? key.slice(prefix.length + 1) : null) : key;
  if (base === null || base.includes('/') || !base.endsWith(ENCRYPTED_SUFFIX)) return null;
  const name = base.slice(0, -ENCRYPTED_SUFFIX.length);
  return parseBackupName(name) ? name : null;
}

export function objectKeyFor(name: string, prefix: string): string {
  return `${prefix ? `${prefix}/` : ''}${name}${ENCRYPTED_SUFFIX}`;
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

/** The most recent daily slot at or before `now` for an "HH:MM" UTC time. */
export function latestSlot(now: Date, timeUtc: string): Date {
  if (!BACKUP_TIME_PATTERN.test(timeUtc)) throw new Error(`invalid schedule time ${timeUtc}`);
  const [hh, mm] = timeUtc.split(':').map(Number);
  const slot = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hh, mm));
  if (slot.getTime() > now.getTime()) slot.setUTCDate(slot.getUTCDate() - 1);
  return slot;
}

export function nextSlot(now: Date, timeUtc: string): Date {
  const latest = latestSlot(now, timeUtc);
  const next = new Date(latest.getTime());
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/**
 * A scheduled backup is due when the latest slot has passed and no
 * scheduled run started at or after it. A run that failed is not retried
 * until the next slot (the stale alert covers a failing schedule); a manual
 * run does not count, so the daily cadence stays predictable.
 */
export function isScheduledBackupDue(now: Date, timeUtc: string, lastScheduledStartedAt: Date | null): boolean {
  const slot = latestSlot(now, timeUtc);
  return lastScheduledStartedAt === null || lastScheduledStartedAt.getTime() < slot.getTime();
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

export interface RetentionCandidate {
  name: string;
  createdAt: Date;
}

export type RetentionSkipReason = 'DISABLED' | 'NO_BACKUPS' | 'NEWEST_NOT_VERIFIED';

export interface RetentionPlan {
  delete: string[];
  keep: string[];
  skipped: RetentionSkipReason | null;
  newestVerified: string | null;
}

/** Newest (by creation time) backup that has a successful verification, or null. */
export function newestVerified(entries: RetentionCandidate[], verified: ReadonlySet<string>): string | null {
  const sorted = [...entries].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return sorted.find((e) => verified.has(e.name))?.name ?? null;
}

/**
 * Which off-site backups to prune. Never deletes anything unless the newest
 * backup is verified, never deletes the newest verified backup, and never
 * deletes a backup younger than `retentionDays`. 0 days turns pruning off.
 */
export function planRetention(entries: RetentionCandidate[], verified: ReadonlySet<string>, now: Date, retentionDays: number): RetentionPlan {
  const names = entries.map((e) => e.name);
  const protectedName = newestVerified(entries, verified);
  if (retentionDays <= 0) return { delete: [], keep: names, skipped: 'DISABLED', newestVerified: protectedName };
  if (entries.length === 0) return { delete: [], keep: [], skipped: 'NO_BACKUPS', newestVerified: null };
  const newest = [...entries].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (!verified.has(newest.name)) return { delete: [], keep: names, skipped: 'NEWEST_NOT_VERIFIED', newestVerified: protectedName };

  const cutoff = now.getTime() - retentionDays * DAY_MS;
  const del: string[] = [];
  const keep: string[] = [];
  for (const e of entries) {
    if (e.name !== protectedName && e.createdAt.getTime() < cutoff) del.push(e.name);
    else keep.push(e.name);
  }
  return { delete: del, keep, skipped: null, newestVerified: protectedName };
}

// ---------------------------------------------------------------------------
// Staleness
// ---------------------------------------------------------------------------

export function hoursSince(then: Date | null, now: Date): number | null {
  if (!then) return null;
  return Math.max(0, Math.round(((now.getTime() - then.getTime()) / HOUR_MS) * 10) / 10);
}

export function isStale(lastSuccessAt: Date | null, now: Date, staleAfterHours: number): boolean {
  return lastSuccessAt === null || now.getTime() - lastSuccessAt.getTime() > staleAfterHours * HOUR_MS;
}
