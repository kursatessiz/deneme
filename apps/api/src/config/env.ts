import { z } from 'zod';

// Validated once at startup; the process refuses to boot on invalid config
// instead of falling back to insecure defaults.
export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url().optional(),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    CORS_ORIGIN: z.string().optional(),
    SMS_PROVIDER: z.enum(['MOCK', 'NETGSM', 'ILETI_MERKEZI']).default('MOCK'),
    PUSH_PROVIDER: z.enum(['MOCK', 'EXPO']).default('MOCK'),
    /** Optional Expo access token when "enhanced push security" is on. */
    EXPO_ACCESS_TOKEN: z.string().min(10).optional(),
    APP_VERSION: z.string().default('0.0.0'),
    /** Base URL of the web/mobile deep-link host; invite links are built on it. */
    PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
    /** Fixed OTP for automated tests. Rejected outside NODE_ENV=test. */
    OTP_TEST_CODE: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
  })
  .superRefine((env, ctx) => {
    if (env.OTP_TEST_CODE && env.NODE_ENV !== 'test') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['OTP_TEST_CODE'], message: 'only allowed when NODE_ENV=test' });
    }
    if (env.NODE_ENV !== 'production') return;
    if (!env.REDIS_URL) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['REDIS_URL'], message: 'required in production' });
    }
    if (!env.CORS_ORIGIN || env.CORS_ORIGIN.split(',').includes('*')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGIN'],
        message: 'must list explicit origins in production',
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return result.data;
}
