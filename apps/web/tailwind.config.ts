import type { Config } from 'tailwindcss';

/**
 * Tailwind is kept for layout only (flex, grid, gap, padding, width). Colors,
 * borders, radii, shadows and type come from Perfect UI (docs/TASARIM.md):
 * there is no custom color scale here on purpose. Preflight is off because
 * its unlayered reset would beat the kit's cascade layers; the minimal reset
 * lives in globals.css inside `@layer reset`.
 */
const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
