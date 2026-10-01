import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  // Emitted for stack symbolication (docs/HATA_RAPORLAMA.md). web.Dockerfile moves the maps out of the
  // served image and CI uploads them to the API keyed by release.
  productionBrowserSourceMaps: true,
  // next/og reads the Inter woff faces from node_modules at request time (src/lib/og/fonts.ts);
  // tracing cannot see that, so the standalone build is told to ship them.
  outputFileTracingIncludes: Object.fromEntries(
    ['/icon', '/apple-icon', '/opengraph-image', '/og'].map((route) => [route, ['./node_modules/@fontsource/inter/files/inter-latin{,-ext}-{400,700}-normal.woff']]),
  ),
  transpilePackages: ['@platform/shared'],
  // ISR for the page engine (docs/SEO.md "ISR"): the production container has a read-only root filesystem, so
  // cached pages live in memory only and are re-rendered after a restart. 64 MB of the 512 MB Node heap
  // (deploy/docker/web.Dockerfile) holds many pages; the least recently used entries are evicted first.
  cacheMaxMemorySize: 64 * 1024 * 1024,
  experimental: { isrFlushToDisk: false },
  // Streaming metadata puts <title> and <meta name="description"> into <body> for browser user agents. Every
  // agent (Lighthouse, link-preview and search crawlers outside Next's built-in bot list) gets them in <head>.
  htmlLimitedBots: /.*/,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  /**
   * Baseline security and cache headers (docs/SEO.md, "Basliklar"). Caddy sets HSTS on every site block
   * (deploy/caddy/Caddyfile), so Strict-Transport-Security is deliberately not repeated here. The CSP
   * stays in src/middleware.ts. Caddy overrides the same headers on the web domain; the tenant-site
   * block has no Permissions-Policy of its own, which this supplies.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(), microphone=()' },
        ],
      },
      // Build output is content-hashed (fonts and chunks under /_next/static), so it never changes under a URL.
      ...(process.env.NODE_ENV === 'production'
        ? [{ source: '/_next/static/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] }]
        : []),
    ];
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
};

export default nextConfig;
