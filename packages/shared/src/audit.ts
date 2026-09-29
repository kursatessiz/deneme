import { z } from 'zod';
import { redactPii } from './marketing/privacy';

/**
 * Super admin audit view (M3d, docs/PAZARLAMA_MODULU.md 6.3):
 * `GET /admin/audit` lists AuditLog rows with filters and pages. The
 * metadata is shown as a short redacted summary, never the raw JSON.
 */

export const AUDIT_PAGE_SIZE_DEFAULT = 50;
export const AUDIT_PAGE_SIZE_MAX = 100;
export const AUDIT_METADATA_SUMMARY_MAX = 200;

export const AuditLogQuerySchema = z
  .object({
    userId: z.string().uuid().optional(),
    /** Action key; matches the action itself or every action that starts with it followed by a dot ("marketing.approval" matches "marketing.approval.approved"). */
    action: z.string().trim().min(1).max(60).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    limit: z.coerce.number().int().min(1).max(AUDIT_PAGE_SIZE_MAX).default(AUDIT_PAGE_SIZE_DEFAULT),
  })
  .strict()
  .refine((q) => q.from === undefined || q.to === undefined || new Date(q.from) <= new Date(q.to), { message: 'Başlangıç bitişten sonra olamaz', path: ['from'] });
export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;

export interface AuditLogItemDTO {
  id: string;
  userId: string | null;
  /** Display name of the acting user; null for system actions or a deleted account. */
  userName: string | null;
  studioId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  /** Short plain text of the metadata with contact details masked. */
  metadataSummary: string;
  createdAt: string;
}

export interface AuditLogListDTO {
  items: AuditLogItemDTO[];
  total: number;
  page: number;
  limit: number;
}

function scalar(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/**
 * "key: value, key: value" of the top level fields (nested values are shown
 * as `{...}` or `[n]`), masked with redactPii and cut to
 * AUDIT_METADATA_SUMMARY_MAX characters.
 */
export function summarizeAuditMetadata(metadata: unknown): string {
  if (metadata === null || metadata === undefined) return '';
  if (typeof metadata !== 'object' || Array.isArray(metadata)) return redactPii(String(scalar(metadata) ?? '')).slice(0, AUDIT_METADATA_SUMMARY_MAX);
  const parts: string[] = [];
  for (const [key, value] of Object.entries(metadata as Record<string, unknown>)) {
    const text = scalar(value) ?? (Array.isArray(value) ? `[${value.length}]` : value === null ? 'null' : '{...}');
    parts.push(`${key}: ${text}`);
  }
  const joined = redactPii(parts.join(', '));
  return joined.length > AUDIT_METADATA_SUMMARY_MAX ? `${joined.slice(0, AUDIT_METADATA_SUMMARY_MAX - 3)}...` : joined;
}
