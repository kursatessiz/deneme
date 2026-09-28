/**
 * The suite runs under the "node" Jest environment (no jsdom), matching
 * the rest of apps/web's unit tests. loadGoogleTag only needs `window` and
 * a `document.head.appendChild`, so this test stubs the minimal shape
 * rather than pulling in a jsdom dependency for one test file.
 */
type StubElement = { src: string; async: boolean };
type StubWindow = { dataLayer?: unknown[][]; gtag?: (...args: unknown[]) => void };

let stubWindow: StubWindow;
let appended: StubElement[];

beforeEach(() => {
  stubWindow = {};
  appended = [];
  (globalThis as unknown as { window: StubWindow }).window = stubWindow;
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => {
      const el: StubElement = { src: '', async: false };
      appended.push(el);
      return el;
    },
    head: { appendChild: () => undefined },
  };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { document?: unknown }).document;
});

// pixels.ts checks `typeof window === 'undefined'` at call time (inside
// each exported function), not at module-import time, so it is safe to
// import this module once here and still see the per-test window/document
// stubs installed by beforeEach above.
import { fetchAdsPixelConfig, loadGoogleTag } from './pixels';

describe('loadGoogleTag', () => {
  it('sets Consent Mode v2 defaults to granted (caller already gated on consent) before the config call', () => {
    loadGoogleTag('AW-123456789', 'evt-1');
    const dataLayer = stubWindow.dataLayer!;
    expect(dataLayer[0]).toEqual([
      'consent',
      'default',
      { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted', analytics_storage: 'granted' },
    ]);
    expect(dataLayer.some((call) => call[0] === 'config' && call[1] === 'AW-123456789')).toBe(true);
    expect(appended[0]?.src).toBe('https://www.googletagmanager.com/gtag/js?id=AW-123456789');
  });
});

describe('fetchAdsPixelConfig', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns the parsed config on a 200 response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ meta: { pixelId: '999' }, google: null, tiktok: null }),
    }) as unknown as typeof fetch;

    const config = await fetchAdsPixelConfig('zen-reformer-pilates');
    expect(config).toEqual({ meta: { pixelId: '999' }, google: null, tiktok: null });
  });

  it('returns an empty config (no pixels load) on a non-200 response', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as unknown as typeof fetch;
    const config = await fetchAdsPixelConfig('unknown-slug');
    expect(config).toEqual({ meta: null, google: null, tiktok: null });
  });

  it('returns an empty config when the network call fails, never throwing', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
    const config = await fetchAdsPixelConfig('zen-reformer-pilates');
    expect(config).toEqual({ meta: null, google: null, tiktok: null });
  });
});
