import { clearVariantPagesCache, isVariantPage } from './variant-pages';

describe('isVariantPage', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    clearVariantPagesCache();
  });

  const respond = (items: Array<{ locale: string; slug: string }>) => {
    const fn = jest.fn(async () => new Response(JSON.stringify({ items }), { status: 200 }));
    global.fetch = fn as unknown as typeof fetch;
    return fn;
  };

  it('is true only for a listed locale and slug, and asks the API once per window', async () => {
    const fn = respond([{ locale: 'tr', slug: 'ab-deneme' }, { locale: 'tr', slug: '' }]);
    expect(await isVariantPage('http://api', 'platform', 'tr', 'ab-deneme', 1000)).toBe(true);
    expect(await isVariantPage('http://api', 'platform', 'tr', '', 2000)).toBe(true);
    expect(await isVariantPage('http://api', 'platform', 'en', 'ab-deneme', 3000)).toBe(false);
    expect(await isVariantPage('http://api', 'platform', 'tr', 'hakkimizda', 4000)).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('keeps sites apart', async () => {
    respond([{ locale: 'tr', slug: 'x' }]);
    expect(await isVariantPage('http://api', 'zen', 'tr', 'x', 1000)).toBe(true);
    respond([]);
    expect(await isVariantPage('http://api', 'flow', 'tr', 'x', 1000)).toBe(false);
  });

  it('refreshes after the window and serves from the cache when the API fails', async () => {
    respond([{ locale: 'tr', slug: 'x' }]);
    expect(await isVariantPage('http://api', 'zen', 'tr', 'x', 0)).toBe(true);
    global.fetch = jest.fn(async () => new Response('x', { status: 500 })) as unknown as typeof fetch;
    // Window over, API down: the last known answer holds.
    expect(await isVariantPage('http://api', 'zen', 'tr', 'x', 70_000)).toBe(true);
  });

  it('treats an unreachable API as no variant page', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('down');
    }) as unknown as typeof fetch;
    expect(await isVariantPage('http://api', 'zen', 'tr', 'x', 0)).toBe(false);
  });
});
