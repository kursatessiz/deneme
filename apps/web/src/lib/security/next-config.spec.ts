import nextConfig from '../../../next.config';

describe('next.config images', () => {
  it('keeps the /_next/image optimizer off so it cannot act as an open image proxy', () => {
    expect(nextConfig.images?.unoptimized).toBe(true);
    expect(nextConfig.images?.remotePatterns ?? []).toEqual([]);
  });
});
