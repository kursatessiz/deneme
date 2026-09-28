import { fetchAdsPixelConfig } from './pixels';

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
