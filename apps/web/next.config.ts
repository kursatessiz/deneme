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
    ['/icon', '/apple-icon', '/opengraph-image', '/og'].map((route) => [route, ['./node_modules/@fontsource/inter/files/inter-latin-{400,700}-normal.woff']]),
  ),
  transpilePackages: ['@platform/shared'],
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
};

export default nextConfig;
