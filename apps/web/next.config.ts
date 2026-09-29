import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  // Emitted for stack symbolication (docs/HATA_RAPORLAMA.md). web.Dockerfile moves the maps out of the
  // served image and CI uploads them to the API keyed by release.
  productionBrowserSourceMaps: true,
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
