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
    // Netgsm credentials. Adapter falls back to MOCK when unset, regardless
    // of SMS_PROVIDER, so a missing credential never blocks the app.
    NETGSM_USER: z.string().min(1).optional(),
    NETGSM_PASSWORD: z.string().min(1).optional(),
    NETGSM_HEADER: z.string().min(1).max(11).optional(),
    // Ileti Merkezi credentials. Same MOCK fallback as Netgsm.
    ILETI_MERKEZI_USER: z.string().min(1).optional(),
    ILETI_MERKEZI_PASSWORD: z.string().min(1).optional(),
    ILETI_MERKEZI_SENDER: z.string().min(1).max(11).optional(),
    // WhatsApp Cloud API. Adapter posts real template messages only when
    // both are set; otherwise it behaves like MOCK SMS (logs and succeeds).
    WHATSAPP_ACCESS_TOKEN: z.string().min(1).optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().min(1).optional(),
    // Iys (Ileti Yonetim Sistemi) brand credentials for the real client. The
    // MOCK IysClient is used until these are set.
    IYS_BRAND_CODE: z.string().min(1).optional(),
    IYS_API_KEY: z.string().min(1).optional(),
    PUSH_PROVIDER: z.enum(['MOCK', 'EXPO']).default('MOCK'),
    /** Optional Expo access token when "enhanced push security" is on. */
    EXPO_ACCESS_TOKEN: z.string().min(10).optional(),
    APP_VERSION: z.string().default('0.0.0'),
    /** Base URL of the web/mobile deep-link host; invite links are built on it. */
    PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
    /** Public origin of this API, used in links it serves itself (calendar feeds). */
    PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),
    /** Fixed OTP for automated tests. Rejected outside NODE_ENV=test. */
    OTP_TEST_CODE: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),

    /** Default payment provider for online checkouts and card charges. MOCK is deterministic. */
    PAYMENT_PROVIDER: z.enum(['MOCK', 'IYZICO', 'PAYTR']).default('MOCK'),
    /** iyzico credentials, required only when PAYMENT_PROVIDER=IYZICO. */
    IYZICO_API_KEY: z.string().min(1).optional(),
    IYZICO_SECRET_KEY: z.string().min(1).optional(),
    IYZICO_BASE_URL: z.string().url().optional(),
    /** PayTR credentials, required only when PAYMENT_PROVIDER=PAYTR. */
    PAYTR_MERCHANT_ID: z.string().min(1).optional(),
    PAYTR_MERCHANT_KEY: z.string().min(1).optional(),
    PAYTR_MERCHANT_SALT: z.string().min(1).optional(),

    // e-invoice integrator credentials. Each studio picks its provider in
    // InvoiceSettings; the matching adapter falls back to a clear
    // "not configured" error until these are set (see docs/INVOICING.md).
    PARASUT_CLIENT_ID: z.string().min(1).optional(),
    PARASUT_CLIENT_SECRET: z.string().min(1).optional(),
    ELOGO_USERNAME: z.string().min(1).optional(),
    ELOGO_PASSWORD: z.string().min(1).optional(),
    FORIBA_USERNAME: z.string().min(1).optional(),
    FORIBA_PASSWORD: z.string().min(1).optional(),
    UYUMSOFT_USERNAME: z.string().min(1).optional(),
    UYUMSOFT_PASSWORD: z.string().min(1).optional(),

    // W20 partner integrations: AES-256-GCM key encrypting PartnerConnection
    // credentials at rest, 32 raw bytes base64-encoded. Optional in
    // dev/test; required in production once any partner connection exists
    // (checked in PartnersService, since it is a data-dependent rule this
    // schema alone cannot express).
    INTEGRATION_ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be base64 for exactly 32 bytes')
      .optional(),
  })
  .superRefine((env, ctx) => {
    if (env.OTP_TEST_CODE && env.NODE_ENV !== 'test') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['OTP_TEST_CODE'], message: 'only allowed when NODE_ENV=test' });
    }
    if (env.PAYMENT_PROVIDER === 'IYZICO' && (!env.IYZICO_API_KEY || !env.IYZICO_SECRET_KEY)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['IYZICO_API_KEY'],
        message: 'IYZICO_API_KEY and IYZICO_SECRET_KEY are required when PAYMENT_PROVIDER=IYZICO',
      });
    }
    if (env.PAYMENT_PROVIDER === 'PAYTR' && (!env.PAYTR_MERCHANT_ID || !env.PAYTR_MERCHANT_KEY || !env.PAYTR_MERCHANT_SALT)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PAYTR_MERCHANT_ID'],
        message: 'PAYTR_MERCHANT_ID, PAYTR_MERCHANT_KEY and PAYTR_MERCHANT_SALT are required when PAYMENT_PROVIDER=PAYTR',
      });
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
