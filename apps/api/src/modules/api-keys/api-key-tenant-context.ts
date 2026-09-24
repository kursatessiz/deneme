import type { ApiKeyScope } from '@platform/shared';

/** The tenant context an ApiKeyGuard resolves for a public-API request. Separate from the JWT session's TenantContext (see tenant-context.ts). */
export interface ApiKeyTenantContext {
  studioId: string;
  apiKeyId: string;
  scopes: ReadonlySet<ApiKeyScope>;
}

export interface ApiKeyAuthenticatedRequest {
  apiKeyTenant?: ApiKeyTenantContext;
  params: Record<string, string | undefined>;
  query: Record<string, unknown>;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
}
