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
    NODE_ENV: process.env.NODE_ENV,
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
