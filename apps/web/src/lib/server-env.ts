import { z } from 'zod';

/**
 * Server-only environment. Never imported from a client component: Next.js
 * would refuse to bundle `API_INTERNAL_URL` into client code anyway since it
 * has no `NEXT_PUBLIC_` prefix, but this module also throws early and
 * loudly if it is ever misused, instead of silently returning undefined.
 */
const ServerEnvSchema = z.object({
  /** Internal (docker-network) base URL of the API, e.g. http://api:4000. No trailing slash. */
  API_INTERNAL_URL: z.string().url().default('http://localhost:4000'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /**
   * Shared secret the API sends to POST /api/revalidate when a site's public content changes (docs/SEO.md
   * "ISR"). Unset disables the endpoint (503): pages then refresh by their 300 second window alone.
   */
  REVALIDATE_SECRET: z.string().min(16, 'REVALIDATE_SECRET must be at least 16 characters').optional(),
  /** Release of this build (deploy passes RELEASE_TAG, e.g. sha-<commit>); tags error reports. */
  APP_RELEASE: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,64}$/)
    .default('dev'),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

let cached: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (typeof window !== 'undefined') {
    throw new Error('getServerEnv() must not be called from client code');
  }
  if (cached) return cached;
  const result = ServerEnvSchema.safeParse({
    API_INTERNAL_URL: process.env.API_INTERNAL_URL,
    REVALIDATE_SECRET: process.env.REVALIDATE_SECRET || undefined,
    NODE_ENV: process.env.NODE_ENV,
    APP_RELEASE: process.env.APP_RELEASE || undefined,
  });
  if (!result.success) {
    const details = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid web server environment configuration: ${details}`);
  }
  cached = result.data;
  return cached;
}

/** API base URL with a trailing slash stripped, for building fetch URLs. */
export function apiInternalBaseUrl(): string {
  return getServerEnv().API_INTERNAL_URL.replace(/\/+$/, '');
}
