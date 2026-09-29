import { nextLocalTime } from './journeys';

/**
 * Send time planning for campaigns (M3c, docs/PAZARLAMA_MODULU.md 4.3 item 4):
 * recipient time zone resolution, the commercial send window, the per-contact
 * engagement histogram and the pure planner that turns a mode into an instant.
 * Everything here is a pure function of its input (no clock, no I/O), so the
 * API and the tests share one implementation.
 */

export const CAMPAIGN_SEND_TIME_MODES = ['FIXED', 'RECIPIENT_LOCAL', 'BEST_TIME'] as const;
export type CampaignSendTimeMode = (typeof CAMPAIGN_SEND_TIME_MODES)[number];

/** "HH:mm", 24-hour. */
export const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Commercial messages are only sent inside this local-time window
 * (docs/BUYUME_VE_GLOBAL_MIMARI.md 2.3, TCPA's 08:00-21:00 applied as the
 * platform-wide default). ComplianceService and the campaign scheduler both
 * read it from here so they can never disagree.
 */
export const COMMERCIAL_SEND_WINDOW = { startHour: 8, endHour: 21 } as const;

/** The time zone the platform assumes for a country when the contact has none (a representative zone for multi-zone countries). */
export const COUNTRY_DEFAULT_TIMEZONES: Readonly<Record<string, string>> = {
  TR: 'Europe/Istanbul', GB: 'Europe/London', IE: 'Europe/Dublin', PT: 'Europe/Lisbon', ES: 'Europe/Madrid', FR: 'Europe/Paris',
  DE: 'Europe/Berlin', IT: 'Europe/Rome', NL: 'Europe/Amsterdam', BE: 'Europe/Brussels', LU: 'Europe/Luxembourg', AT: 'Europe/Vienna',
  CH: 'Europe/Zurich', SE: 'Europe/Stockholm', NO: 'Europe/Oslo', DK: 'Europe/Copenhagen', FI: 'Europe/Helsinki', IS: 'Atlantic/Reykjavik',
  PL: 'Europe/Warsaw', CZ: 'Europe/Prague', SK: 'Europe/Bratislava', HU: 'Europe/Budapest', RO: 'Europe/Bucharest', BG: 'Europe/Sofia',
  GR: 'Europe/Athens', CY: 'Asia/Nicosia', HR: 'Europe/Zagreb', SI: 'Europe/Ljubljana', RS: 'Europe/Belgrade', UA: 'Europe/Kiev',
  RU: 'Europe/Moscow', EE: 'Europe/Tallinn', LV: 'Europe/Riga', LT: 'Europe/Vilnius', MT: 'Europe/Malta', LI: 'Europe/Vaduz',
  US: 'America/Chicago', CA: 'America/Toronto', MX: 'America/Mexico_City', BR: 'America/Sao_Paulo', AR: 'America/Argentina/Buenos_Aires',
  CL: 'America/Santiago', CO: 'America/Bogota', PE: 'America/Lima', AU: 'Australia/Sydney', NZ: 'Pacific/Auckland',
  JP: 'Asia/Tokyo', KR: 'Asia/Seoul', CN: 'Asia/Shanghai', HK: 'Asia/Hong_Kong', IN: 'Asia/Kolkata', PK: 'Asia/Karachi',
  ID: 'Asia/Jakarta', SG: 'Asia/Singapore', MY: 'Asia/Kuala_Lumpur', TH: 'Asia/Bangkok', VN: 'Asia/Ho_Chi_Minh', PH: 'Asia/Manila',
  AE: 'Asia/Dubai', SA: 'Asia/Riyadh', QA: 'Asia/Qatar', KW: 'Asia/Kuwait', IL: 'Asia/Jerusalem', EG: 'Africa/Cairo',
  ZA: 'Africa/Johannesburg', NG: 'Africa/Lagos', KE: 'Africa/Nairobi', MA: 'Africa/Casablanca', AZ: 'Asia/Baku', GE: 'Asia/Tbilisi',
  KZ: 'Asia/Almaty',
};

/** The default zone of a country, or null when the platform has none for it. */
export function defaultTimeZoneOfCountry(countryCode: string | null | undefined): string | null {
  if (!countryCode) return null;
  const zone = COUNTRY_DEFAULT_TIMEZONES[countryCode.toUpperCase()];
  return zone && isValidTimeZone(zone) ? zone : null;
}

export function isValidTimeZone(zone: string | null | undefined): zone is string {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

/**
 * The zone a recipient's local clock runs on: their own time zone, else the
 * default zone of their country, else the tenant's zone, else UTC.
 */
export function resolveRecipientTimeZone(input: {
  timezone?: string | null;
  countryCode?: string | null;
  studioTimezone?: string | null;
}): string {
  if (isValidTimeZone(input.timezone)) return input.timezone;
  const country = defaultTimeZoneOfCountry(input.countryCode);
  if (country) return country;
  if (isValidTimeZone(input.studioTimezone)) return input.studioTimezone;
  return 'UTC';
}

/** Hour of day (0-23) of an instant on a zone's wall clock. */
export function localHourOf(date: Date, timeZone: string): number {
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' }).format(date)) % 24;
}

export function isWithinSendWindow(date: Date, timeZone: string): boolean {
  const hour = localHourOf(date, timeZone);
  return hour >= COMMERCIAL_SEND_WINDOW.startHour && hour < COMMERCIAL_SEND_WINDOW.endHour;
}

/** `instant` itself when it is inside the send window on the zone's clock, otherwise the next window start. */
export function nextAllowedSendInstant(instant: Date, timeZone: string): Date {
  if (isWithinSendWindow(instant, timeZone)) return instant;
  return nextLocalTime(instant, `${String(COMMERCIAL_SEND_WINDOW.startHour).padStart(2, '0')}:00`, timeZone);
}

// ---------------------------------------------------------------------------
// Engagement histogram (best send time)
// ---------------------------------------------------------------------------

export const HISTOGRAM_HOURS = 24;
/** Interactions a contact needs before their own history decides (docs 4.3 item 4). */
export const BEST_TIME_MIN_RECIPIENT_INTERACTIONS = 3;
/** Interactions the tenant-wide histogram needs before it stands in for a contact. */
export const BEST_TIME_MIN_STUDIO_INTERACTIONS = 10;
/** Only this many trailing days of opens and clicks count. */
export const BEST_TIME_LOOKBACK_DAYS = 90;

/** 24 counters: interactions per local hour of day. */
export type HourHistogram = number[];

export function emptyHourHistogram(): HourHistogram {
  return Array.from({ length: HISTOGRAM_HOURS }, () => 0);
}

/** Counts each instant on the wall clock of `timeZone` (an unknown zone reads as UTC). */
export function buildHourHistogram(instants: ReadonlyArray<Date | string | number>, timeZone: string): HourHistogram {
  const histogram = emptyHourHistogram();
  for (const raw of instants) {
    const date = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(date.getTime())) continue;
    histogram[localHourOf(date, timeZone)] += 1;
  }
  return histogram;
}

export function histogramTotal(histogram: readonly number[]): number {
  return histogram.reduce((a, b) => a + b, 0);
}

/** The hour with the most interactions (the earliest hour wins a tie), or null when there are fewer than `minInteractions`. */
export function bestHourOf(histogram: readonly number[] | null | undefined, minInteractions: number): number | null {
  if (!histogram || histogram.length !== HISTOGRAM_HOURS) return null;
  if (histogramTotal(histogram) < Math.max(1, minInteractions)) return null;
  let best = 0;
  for (let hour = 1; hour < HISTOGRAM_HOURS; hour += 1) {
    if (histogram[hour] > histogram[best]) best = hour;
  }
  return best;
}

export type BestHourSource = 'RECIPIENT' | 'STUDIO' | 'FALLBACK';

export interface BestHourResolution {
  /** Null for FALLBACK: the caller sends at the campaign's fallback local time. */
  hour: number | null;
  source: BestHourSource;
}

/**
 * The fallback chain of the BEST_TIME mode: the contact's own history, then
 * the tenant-wide histogram, then the fallback local time (hour null).
 */
export function resolveBestHour(input: {
  recipient?: readonly number[] | null;
  studio?: readonly number[] | null;
  minRecipientInteractions?: number;
  minStudioInteractions?: number;
}): BestHourResolution {
  const own = bestHourOf(input.recipient, input.minRecipientInteractions ?? BEST_TIME_MIN_RECIPIENT_INTERACTIONS);
  if (own !== null) return { hour: own, source: 'RECIPIENT' };
  const studio = bestHourOf(input.studio, input.minStudioInteractions ?? BEST_TIME_MIN_STUDIO_INTERACTIONS);
  if (studio !== null) return { hour: studio, source: 'STUDIO' };
  return { hour: null, source: 'FALLBACK' };
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

export type SendTimeSource = 'FIXED' | 'LOCAL' | 'BEST_RECIPIENT' | 'BEST_STUDIO' | 'BEST_FALLBACK';

export interface PlannedSend {
  at: Date;
  source: SendTimeSource;
}

/**
 * When one recipient's message is due, never earlier than `startAt` and never
 * outside the commercial send window on the recipient's own clock (a slot
 * that lands in quiet hours moves to the next window start). FIXED keeps the
 * start instant: the messaging engine still holds it back per recipient.
 */
export function planRecipientSend(input: {
  mode: CampaignSendTimeMode;
  startAt: Date;
  timeZone: string;
  /** The campaign's "HH:mm" (RECIPIENT_LOCAL, and the BEST_TIME fallback). */
  sendTimeLocal: string | null;
  /** The tenant's default local time when the campaign has none. */
  defaultLocal: string;
  best: BestHourResolution | null;
}): PlannedSend {
  if (input.mode === 'FIXED') return { at: input.startAt, source: 'FIXED' };
  let hhmm = input.sendTimeLocal ?? input.defaultLocal;
  let source: SendTimeSource = 'LOCAL';
  if (input.mode === 'BEST_TIME') {
    if (input.best && input.best.hour !== null) {
      hhmm = `${String(input.best.hour).padStart(2, '0')}:00`;
      source = input.best.source === 'RECIPIENT' ? 'BEST_RECIPIENT' : 'BEST_STUDIO';
    } else {
      source = 'BEST_FALLBACK';
    }
  }
  // "First instant at or after startAt whose local clock reads hhmm".
  const slot = nextLocalTime(new Date(input.startAt.getTime() - 1), hhmm, input.timeZone);
  return { at: nextAllowedSendInstant(slot, input.timeZone), source };
}
