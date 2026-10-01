import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Inter faces for next/og ImageResponse, read from the installed
 * `@fontsource/inter` package (no network fetch). satori accepts woff but not
 * woff2. next.config.ts lists these files in `outputFileTracingIncludes` so
 * the standalone build ships them.
 */
export interface OgFont {
  name: 'Inter';
  data: Buffer;
  weight: 400 | 700;
  style: 'normal';
}

const FONT_DIR = ['node_modules', '@fontsource', 'inter', 'files'];
let cache: Promise<OgFont[]> | null = null;

export function loadOgFonts(): Promise<OgFont[]> {
  if (!cache) {
    const load = async (weight: 400 | 700): Promise<OgFont> => ({
      name: 'Inter',
      weight,
      style: 'normal',
      data: await readFile(path.join(process.cwd(), ...FONT_DIR, `inter-latin-${weight}-normal.woff`)),
    });
    cache = Promise.all([load(400), load(700)]).catch((err: unknown) => {
      cache = null; // retry on the next request instead of caching a failure
      throw err;
    });
  }
  return cache;
}
