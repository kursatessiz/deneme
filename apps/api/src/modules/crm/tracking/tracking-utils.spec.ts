import { countryFromHeaders, deviceTypeOf, isLikelyBot, parseLanding, readVisitorId, referrerHostOf } from './tracking-utils';

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const VID = '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f';

describe('tracking utils', () => {
  it('strips query string and fragment from the landing URL', () => {
    expect(parseLanding('https://Example.com/tr/pilates?utm_source=google&gclid=abc#pricing')).toEqual({
      host: 'example.com',
      path: '/tr/pilates',
    });
    expect(parseLanding('https://example.com?x=1')).toEqual({ host: 'example.com', path: '/' });
  });

  it('rejects non-http landing URLs', () => {
    expect(parseLanding('javascript:alert(1)')).toBeNull();
    expect(parseLanding('not a url')).toBeNull();
  });

  it('keeps only an external referrer host', () => {
    expect(referrerHostOf('https://www.google.com/search?q=secret', 'example.com')).toBe('www.google.com');
    expect(referrerHostOf('https://example.com/other?a=1', 'example.com')).toBeNull();
    expect(referrerHostOf(undefined, 'example.com')).toBeNull();
    expect(referrerHostOf('garbage', 'example.com')).toBeNull();
  });

  it('flags bots, headless browsers and missing user agents', () => {
    expect(isLikelyBot(undefined)).toBe(true);
    expect(isLikelyBot('')).toBe(true);
    expect(isLikelyBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true);
    expect(isLikelyBot('facebookexternalhit/1.1')).toBe(true);
    expect(isLikelyBot('curl/8.5.0')).toBe(true);
    expect(isLikelyBot(CHROME.replace('Chrome/', 'HeadlessChrome/'))).toBe(true);
    expect(isLikelyBot(CHROME)).toBe(false);
    expect(isLikelyBot(IPHONE)).toBe(false);
  });

  it('classifies the device', () => {
    expect(deviceTypeOf(CHROME)).toBe('desktop');
    expect(deviceTypeOf(IPHONE)).toBe('mobile');
    expect(deviceTypeOf('Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X)')).toBe('tablet');
  });

  it('reads a coarse country only from the edge proxy headers', () => {
    expect(countryFromHeaders({ 'cf-ipcountry': 'de' })).toBe('DE');
    expect(countryFromHeaders({ 'x-country-code': 'TR' })).toBe('TR');
    expect(countryFromHeaders({ 'cf-ipcountry': 'XX' })).toBeNull();
    expect(countryFromHeaders({ 'cf-ipcountry': 'T1' })).toBeNull();
    expect(countryFromHeaders({ 'x-forwarded-for': '1.2.3.4' })).toBeNull();
  });

  it('reads the visitor id from the header or the cookie, never trusting other shapes', () => {
    expect(readVisitorId({ 'x-pw-vid': VID.toUpperCase() })).toBe(VID);
    expect(readVisitorId({ cookie: `a=1; pw_vid=${VID}; b=2` })).toBe(VID);
    expect(readVisitorId({ cookie: 'pw_vid=not-a-uuid' })).toBeNull();
    expect(readVisitorId({ 'x-pw-vid': 'nope' })).toBeNull();
    expect(readVisitorId({})).toBeNull();
  });
});
