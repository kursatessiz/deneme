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
    SMS_PROVIDER: z.enum(['MOCK', 'NETGSM', 'ILETI_MERKEZI', 'TWILIO']).default('MOCK'),
    /** Provider SMS credit balance below which the hourly heartbeat check alerts super admins. */
    SMS_PROVIDER_LOW_BALANCE_THRESHOLD: z.coerce.number().int().positive().default(500),
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
    PAYMENT_PROVIDER: z.enum(['MOCK', 'IYZICO', 'PAYTR', 'STRIPE']).default('MOCK'),
    /** iyzico credentials, required only when PAYMENT_PROVIDER=IYZICO. */
    IYZICO_API_KEY: z.string().min(1).optional(),
    IYZICO_SECRET_KEY: z.string().min(1).optional(),
    IYZICO_BASE_URL: z.string().url().optional(),
    /** PayTR credentials, required only when PAYMENT_PROVIDER=PAYTR. */
    PAYTR_MERCHANT_ID: z.string().min(1).optional(),
    PAYTR_MERCHANT_KEY: z.string().min(1).optional(),
    PAYTR_MERCHANT_SALT: z.string().min(1).optional(),
    // Stripe: the platform's global default payment provider. The adapter
    // falls back to MOCK when unset, like every other adapter.
    STRIPE_SECRET_KEY: z.string().min(1).optional(),
    STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
    STRIPE_CHECKOUT_SUCCESS_URL: z.string().url().optional(),
    STRIPE_CHECKOUT_CANCEL_URL: z.string().url().optional(),
    // Twilio: the platform's global default SMS provider. Same MOCK
    // fallback as Netgsm/Ileti Merkezi.
    TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
    TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
    TWILIO_FROM_NUMBER: z.string().min(1).optional(),

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

    // G1c messaging engine (docs/MESAJLASMA.md).
    /** Amazon SES: region and verified sender address. Credentials come from the AWS SDK default chain. */
    SES_REGION: z.string().regex(/^[a-z]{2}-[a-z]+-\d$/, 'must be an AWS region like eu-central-1').optional(),
    SES_FROM_ADDRESS: z.string().email().optional(),
    /** Display name for platform emails without a studio. */
    SES_FROM_NAME: z.string().min(1).max(80).optional(),
    /** SES configuration set that publishes bounce/complaint/delivery events to SNS. */
    SES_CONFIGURATION_SET: z.string().min(1).optional(),
    /** Comma-separated SNS topic ARNs accepted by the SES webhook; empty accepts any verified topic. */
    SES_SNS_TOPIC_ARNS: z.string().optional(),
    /** HMAC key for open/click/unsubscribe tokens. Required for commercial email in production. */
    MESSAGING_TRACKING_SECRET: z.string().min(32, 'MESSAGING_TRACKING_SECRET must be at least 32 characters').optional(),
    /** Meta app secret (X-Hub-Signature-256) and the webhook verify token of the WhatsApp Cloud API app. */
    WHATSAPP_APP_SECRET: z.string().min(1).optional(),
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().min(16).optional(),
    /** Shared secret in the Netgsm / İleti Merkezi delivery-report URL. */
    SMS_DLR_WEBHOOK_TOKEN: z.string().min(24).optional(),

    // G3b AI core (docs/YAPAY_ZEKA.md). The super admin normally stores the
    // Anthropic key encrypted in the database from the AI settings screen;
    // this env var is only the fallback when no key is stored.
    ANTHROPIC_API_KEY: z.string().min(20).optional(),
    /** Test-only deterministic AI provider (web e2e suite). Refused in production. */
    AI_FAKE_PROVIDER: z.enum(['0', '1']).optional(),

    // H1 error reporting (docs/HATA_RAPORLAMA.md).
    /** Release of this build (the deploy passes RELEASE_TAG, e.g. sha-<commit>). */
    APP_RELEASE: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,64}$/, 'must be 1-64 characters of letters, digits, dot, dash or underscore')
      .default('dev'),
    /** Salt for userIdHash on error events; falls back to a key derived from JWT_SECRET. */
    ERROR_USER_HASH_SALT: z.string().min(16).optional(),
    /** Share of client (web/mobile) error events kept, 0..1. */
    ERROR_CLIENT_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1),
    /** Minimum minutes between two alert emails for the same error group. */
    ERROR_ALERT_COOLDOWN_MINUTES: z.coerce.number().int().min(1).max(10080).default(60),
    /** 0 turns the super admin alert and digest emails off (errors are still recorded). */
    ERROR_ALERTS_ENABLED: z.enum(['0', '1']).default('1'),

    /** Base URL for JITSI-generated meeting rooms (W19). Must be https. */
    JITSI_BASE_URL: z.string().url().default('https://meet.jit.si'),
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
    if (env.PAYMENT_PROVIDER === 'STRIPE' && !env.STRIPE_SECRET_KEY) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['STRIPE_SECRET_KEY'], message: 'required when PAYMENT_PROVIDER=STRIPE' });
    }
    if (!env.JITSI_BASE_URL.startsWith('https://')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['JITSI_BASE_URL'], message: 'must be an https URL' });
    }
    if (env.NODE_ENV !== 'production') return;
    if (env.AI_FAKE_PROVIDER === '1') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['AI_FAKE_PROVIDER'], message: 'must not be enabled in production' });
    }
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

/**
 * An empty value means "not set". docker-compose.prod.yml passes every
 * optional key as `KEY: ${KEY:-}` (so a key can never be silently missing
 * from the container), and an unset one arrives as an empty string; without
 * this, `z.string().min(1).optional()` would reject it and a default would
 * never apply.
 */
export function withoutEmptyValues(raw: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== ''));
}

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(withoutEmptyValues(raw));
  if (!result.success) {
    const details = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return result.data;
}
