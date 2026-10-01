import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Inter faces for next/og ImageResponse, read from the installed
 * `@fontsource/inter` package (no network fetch). satori accepts woff but not
 * woff2. next.config.ts lists these files in `outputFileTracingIncludes` so
 * the standalone build ships them.
 */
export interface OgFont {
  name: 'Inter' | 'InterExt';
  data: Buffer;
  weight: 400 | 700;
  style: 'normal';
}

/** CSS font-family value for ImageResponse content. */
export const OG_FONT_FAMILY = 'Inter, InterExt';

const FONT_DIR = ['node_modules', '@fontsource', 'inter', 'files'];
let cache: Promise<OgFont[]> | null = null;

export function loadOgFonts(): Promise<OgFont[]> {
  if (!cache) {
    // latin-ext carries the Turkish letters (g breve, s cedilla, dotted I) that the base latin subset lacks.
    // It is registered as its own family: satori falls back per glyph along the CSS font-family list
    // (OG_FONT_FAMILY), whereas two faces of one family and weight are not combined.
    const load = async (subset: 'latin' | 'latin-ext', weight: 400 | 700): Promise<OgFont> => ({
      name: subset === 'latin' ? 'Inter' : 'InterExt',
      weight,
      style: 'normal',
      data: await readFile(path.join(process.cwd(), ...FONT_DIR, `inter-${subset}-${weight}-normal.woff`)),
    });
    cache = Promise.all([load('latin', 400), load('latin', 700), load('latin-ext', 400), load('latin-ext', 700)]).catch((err: unknown) => {
      cache = null; // retry on the next request instead of caching a failure
      throw err;
    });
  }
  return cache;
}
