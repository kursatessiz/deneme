import { z } from 'zod';
import { CurrencyCodeSchema } from './regions';

/**
 * Conversion events: the single funnel vocabulary shared by reports, journeys
 * and the ad platform outbox (Meta Conversions API, Google Ads). See
 * docs/BUYUME_VE_GLOBAL_MIMARI.md section 3.2-3.3.
 */

export const CONVERSION_EVENT_TYPES = [
  'lead',
  'trial_booked',
  'trial_attended',
  'purchase',
  'subscription_started',
  'subscription_renewed',
  /** Platform tenant only: a new studio account was created. */
  'studio_signup',
  /** Platform tenant only: a studio paid its first platform invoice. */
  'studio_paid',
] as const;
export type ConversionEventType = (typeof CONVERSION_EVENT_TYPES)[number];

/** Meta standard event names. */
export const META_EVENT_NAME: Readonly<Record<ConversionEventType, string>> = {
  lead: 'Lead',
  trial_booked: 'Schedule',
  trial_attended: 'StartTrial',
  purchase: 'Purchase',
  subscription_started: 'Subscribe',
  subscription_renewed: 'Subscribe',
  studio_signup: 'CompleteRegistration',
  studio_paid: 'Purchase',
};

/** Which events carry a value that ad platforms should optimise for. */
export const VALUE_BEARING_EVENTS: ReadonlySet<ConversionEventType> = new Set([
  'purchase',
  'subscription_started',
  'subscription_renewed',
  'studio_paid',
]);

export const ConversionEventSchema = z
  .object({
    /** Stable id shared with the browser pixel so the platforms de-duplicate. */
    eventId: z.string().min(8).max(100),
    type: z.enum(CONVERSION_EVENT_TYPES),
    occurredAt: z.string().datetime(),
    contactId: z.string().uuid(),
    value: z
      .object({
        amount: z.string().regex(/^\d{1,12}(\.\d{1,4})?$/),
        currency: CurrencyCodeSchema,
      })
      .strict()
      .optional(),
    /** Source record, e.g. { kind: 'payment', id } for idempotency and audits. */
    source: z.object({ kind: z.string().max(40), id: z.string().max(100) }).strict(),
    /** Test traffic is stored but never sent to ad platforms or counted in reports. */
    isTest: z.boolean().default(false),
  })
  .strict();
export type ConversionEvent = z.infer<typeof ConversionEventSchema>;

export const CONVERSION_DELIVERY_TARGETS = ['META_CAPI', 'GOOGLE_ADS', 'TIKTOK_EVENTS', 'LINKEDIN_CAPI'] as const;
export type ConversionDeliveryTarget = (typeof CONVERSION_DELIVERY_TARGETS)[number];

export const CONVERSION_DELIVERY_STATUSES = ['PENDING', 'SENT', 'SKIPPED_NO_CONSENT', 'SKIPPED_NO_MATCH', 'FAILED'] as const;
export type ConversionDeliveryStatus = (typeof CONVERSION_DELIVERY_STATUSES)[number];

/** Retry schedule for outbox deliveries, in seconds after the first attempt. */
export const CONVERSION_RETRY_DELAYS_SECONDS = [60, 300, 1800, 7200, 21600] as const;
export const CONVERSION_MAX_ATTEMPTS = CONVERSION_RETRY_DELAYS_SECONDS.length;

/** Delay in seconds before the given attempt number is retried (attempt is 1-based, the attempt that just failed). Past the last configured delay the delivery is abandoned as FAILED (dead-letter). */
export function conversionDeliveryBackoffSeconds(attempt: number): number {
  const index = Math.min(Math.max(attempt, 1), CONVERSION_RETRY_DELAYS_SECONDS.length) - 1;
  return CONVERSION_RETRY_DELAYS_SECONDS[index];
}

/** Contact lifecycle stages (section 3.1). */
export const LIFECYCLE_STAGES = ['LEAD', 'TRIAL', 'MEMBER', 'LAPSED', 'LOST'] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];
