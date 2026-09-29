import {
  BEST_TIME_MIN_RECIPIENT_INTERACTIONS,
  BEST_TIME_MIN_STUDIO_INTERACTIONS,
  COMMERCIAL_SEND_WINDOW,
  bestHourOf,
  buildHourHistogram,
  defaultTimeZoneOfCountry,
  isWithinSendWindow,
  localHourOf,
  nextAllowedSendInstant,
  planRecipientSend,
  resolveBestHour,
  resolveRecipientTimeZone,
} from './send-time';
import { parseMessagingSettings } from '../messaging-engine';

const at = (iso: string) => new Date(iso);

describe('resolveRecipientTimeZone', () => {
  it('prefers the contact zone, then the country default, then the studio zone, then UTC', () => {
    expect(resolveRecipientTimeZone({ timezone: 'Asia/Tokyo', countryCode: 'TR', studioTimezone: 'Europe/London' })).toBe('Asia/Tokyo');
    expect(resolveRecipientTimeZone({ timezone: null, countryCode: 'tr', studioTimezone: 'Europe/London' })).toBe('Europe/Istanbul');
    expect(resolveRecipientTimeZone({ timezone: 'Not/AZone', countryCode: 'ZZ', studioTimezone: 'Europe/London' })).toBe('Europe/London');
    expect(resolveRecipientTimeZone({})).toBe('UTC');
    expect(defaultTimeZoneOfCountry('ZZ')).toBeNull();
    expect(defaultTimeZoneOfCountry(null)).toBeNull();
  });
});

describe('send window', () => {
  it('matches the compliance quiet hours on the recipient clock', () => {
    expect(COMMERCIAL_SEND_WINDOW).toEqual({ startHour: 8, endHour: 21 });
    // 2026-10-05T00:00Z is 09:00 in Tokyo and 20:00 the day before in New York (EDT).
    expect(isWithinSendWindow(at('2026-10-05T00:00:00Z'), 'Asia/Tokyo')).toBe(true);
    expect(isWithinSendWindow(at('2026-10-05T00:00:00Z'), 'America/New_York')).toBe(true);
    expect(isWithinSendWindow(at('2026-10-05T01:30:00Z'), 'America/New_York')).toBe(false);
    expect(localHourOf(at('2026-10-05T00:00:00Z'), 'Asia/Tokyo')).toBe(9);
  });

  it('moves an instant in quiet hours to the next window start and keeps an allowed one', () => {
    const inside = at('2026-10-05T03:00:00Z'); // 12:00 Tokyo
    expect(nextAllowedSendInstant(inside, 'Asia/Tokyo')).toEqual(inside);
    // 22:30 Tokyo -> 08:00 Tokyo next day = 2026-10-05T23:00Z
    expect(nextAllowedSendInstant(at('2026-10-05T13:30:00Z'), 'Asia/Tokyo')).toEqual(at('2026-10-05T23:00:00Z'));
    // 03:00 Tokyo -> 08:00 the same day
    expect(nextAllowedSendInstant(at('2026-10-04T18:00:00Z'), 'Asia/Tokyo')).toEqual(at('2026-10-04T23:00:00Z'));
  });
});

describe('hour histogram', () => {
  it('counts instants per local hour of the zone', () => {
    const hist = buildHourHistogram(['2026-10-03T05:10:00Z', '2026-10-03T05:50:00Z', '2026-10-04T06:00:00Z', 'not a date'], 'Asia/Tokyo');
    expect(hist).toHaveLength(24);
    expect(hist[14]).toBe(2);
    expect(hist[15]).toBe(1);
    expect(hist.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('picks the busiest hour, the earliest on a tie, and null under the minimum', () => {
    const hist = new Array<number>(24).fill(0);
    hist[9] = 2;
    hist[14] = 2;
    hist[20] = 1;
    expect(bestHourOf(hist, 3)).toBe(9);
    expect(bestHourOf(hist, 6)).toBeNull();
    expect(bestHourOf(null, 1)).toBeNull();
    expect(bestHourOf([1, 2, 3], 1)).toBeNull();
  });
});

describe('resolveBestHour (fallback chain)', () => {
  const own = new Array<number>(24).fill(0);
  own[7] = BEST_TIME_MIN_RECIPIENT_INTERACTIONS;
  const thinOwn = new Array<number>(24).fill(0);
  thinOwn[7] = BEST_TIME_MIN_RECIPIENT_INTERACTIONS - 1;
  const studio = new Array<number>(24).fill(0);
  studio[16] = BEST_TIME_MIN_STUDIO_INTERACTIONS;
  const thinStudio = new Array<number>(24).fill(0);
  thinStudio[16] = BEST_TIME_MIN_STUDIO_INTERACTIONS - 1;

  it('uses the recipient history, then the studio histogram, then the fallback', () => {
    expect(resolveBestHour({ recipient: own, studio })).toEqual({ hour: 7, source: 'RECIPIENT' });
    expect(resolveBestHour({ recipient: thinOwn, studio })).toEqual({ hour: 16, source: 'STUDIO' });
    expect(resolveBestHour({ recipient: thinOwn, studio: thinStudio })).toEqual({ hour: null, source: 'FALLBACK' });
    expect(resolveBestHour({})).toEqual({ hour: null, source: 'FALLBACK' });
  });
});

describe('planRecipientSend', () => {
  const base = { startAt: at('2026-10-05T00:00:00Z'), defaultLocal: '10:00', best: null } as const;

  it('FIXED keeps the start instant', () => {
    expect(planRecipientSend({ ...base, mode: 'FIXED', timeZone: 'Asia/Tokyo', sendTimeLocal: null })).toEqual({ at: base.startAt, source: 'FIXED' });
  });

  it('RECIPIENT_LOCAL schedules each recipient at the local time on their own clock', () => {
    const tokyo = planRecipientSend({ ...base, mode: 'RECIPIENT_LOCAL', timeZone: 'Asia/Tokyo', sendTimeLocal: '10:00' });
    expect(tokyo).toEqual({ at: at('2026-10-05T01:00:00Z'), source: 'LOCAL' });
    // New York is at 20:00 the day before (EDT): 10:00 comes at 14:00Z the same UTC day.
    const ny = planRecipientSend({ ...base, mode: 'RECIPIENT_LOCAL', timeZone: 'America/New_York', sendTimeLocal: '10:00' });
    expect(ny.at).toEqual(at('2026-10-05T14:00:00Z'));
  });

  it('a local time already passed today goes to tomorrow, and the exact start instant counts as due', () => {
    expect(planRecipientSend({ ...base, mode: 'RECIPIENT_LOCAL', timeZone: 'Asia/Tokyo', sendTimeLocal: '08:00' }).at).toEqual(at('2026-10-05T23:00:00Z'));
    expect(planRecipientSend({ ...base, mode: 'RECIPIENT_LOCAL', timeZone: 'Asia/Tokyo', sendTimeLocal: '09:00' }).at).toEqual(base.startAt);
  });

  it('never plans inside quiet hours: a 23:00 local time becomes the next 08:00', () => {
    const late = planRecipientSend({ ...base, mode: 'RECIPIENT_LOCAL', timeZone: 'Asia/Tokyo', sendTimeLocal: '23:00' });
    expect(late.at).toEqual(at('2026-10-05T23:00:00Z'));
    expect(localHourOf(late.at, 'Asia/Tokyo')).toBe(8);
    const early = planRecipientSend({ ...base, mode: 'RECIPIENT_LOCAL', timeZone: 'Asia/Tokyo', sendTimeLocal: '03:00' });
    expect(localHourOf(early.at, 'Asia/Tokyo')).toBe(8);
  });

  it('falls back to the tenant default time when the campaign has none', () => {
    expect(planRecipientSend({ ...base, mode: 'RECIPIENT_LOCAL', timeZone: 'Asia/Tokyo', sendTimeLocal: null }).at).toEqual(at('2026-10-05T01:00:00Z'));
  });

  it('BEST_TIME uses the resolved hour, or the fallback local time when there is none', () => {
    const own = planRecipientSend({ ...base, mode: 'BEST_TIME', timeZone: 'Asia/Tokyo', sendTimeLocal: '10:00', best: { hour: 14, source: 'RECIPIENT' } });
    expect(own).toEqual({ at: at('2026-10-05T05:00:00Z'), source: 'BEST_RECIPIENT' });
    const studio = planRecipientSend({ ...base, mode: 'BEST_TIME', timeZone: 'Asia/Tokyo', sendTimeLocal: '10:00', best: { hour: 16, source: 'STUDIO' } });
    expect(studio).toEqual({ at: at('2026-10-05T07:00:00Z'), source: 'BEST_STUDIO' });
    const fallback = planRecipientSend({ ...base, mode: 'BEST_TIME', timeZone: 'Asia/Tokyo', sendTimeLocal: '09:30', best: { hour: null, source: 'FALLBACK' } });
    expect(fallback).toEqual({ at: at('2026-10-05T00:30:00Z'), source: 'BEST_FALLBACK' });
    // A best hour inside quiet hours (03:00) is moved to the window start.
    const quiet = planRecipientSend({ ...base, mode: 'BEST_TIME', timeZone: 'Asia/Tokyo', sendTimeLocal: null, best: { hour: 3, source: 'RECIPIENT' } });
    expect(localHourOf(quiet.at, 'Asia/Tokyo')).toBe(8);
  });
});

describe('tenant default send time', () => {
  it('is data in the messaging settings, with a platform default when unset', () => {
    expect(parseMessagingSettings({}).defaultSendTimeLocal).toBe('10:00');
    expect(parseMessagingSettings({ defaultSendTimeLocal: '18:30' }).defaultSendTimeLocal).toBe('18:30');
    expect(parseMessagingSettings({ defaultSendTimeLocal: '99:99' }).defaultSendTimeLocal).toBe('10:00');
  });
});
