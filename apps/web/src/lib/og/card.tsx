import { ImageResponse } from 'next/og';
import { deriveBrandPalette } from '@platform/shared';
import { OG_FONT_FAMILY, loadOgFonts } from './fonts';

export const OG_SIZE = { width: 1200, height: 630 } as const;

export interface OgCardInput {
  title: string;
  description?: string | null;
  /** Studio or product name, drawn above the title. */
  name?: string | null;
  /** Brand primary colour (#RRGGBB); the card is flat, as gradients are reserved for the member and package cards (docs/TASARIM.md). */
  primary: string;
  /** Logo as a data URI (see fetchLogoDataUri). */
  logoDataUri?: string | null;
  cacheSeconds?: number;
}

function clip(text: string, max: number): string {
  const chars = Array.from(text.trim());
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}

/** The shared Open Graph card: title, description, name and optional logo on the brand primary colour. */
export async function renderOgCard(input: OgCardInput): Promise<ImageResponse> {
  // The owner's color, corrected for contrast the same way the apps do (brand.ts).
  const brand = deriveBrandPalette(input.primary);
  const ink = brand.onPrimary;
  const title = clip(input.title, 90);
  const description = input.description ? clip(input.description, 170) : null;
  const name = input.name ? clip(input.name, 60) : null;
  const cacheSeconds = input.cacheSeconds ?? 3600;

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 72, background: brand.primary, color: ink, fontFamily: OG_FONT_FAMILY }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, minHeight: 64 }}>
          {input.logoDataUri ? (
            <div style={{ display: 'flex', alignItems: 'center', background: '#ffffff', borderRadius: 12, padding: 12 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={input.logoDataUri} height={64} alt="" style={{ height: 64, objectFit: 'contain' }} />
            </div>
          ) : null}
          {name ? <div style={{ fontSize: 36, fontWeight: 700 }}>{name}</div> : null}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.1 }}>{title}</div>
          {description ? <div style={{ fontSize: 32, fontWeight: 400, lineHeight: 1.35, opacity: 0.9 }}>{description}</div> : null}
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: await loadOgFonts(),
      headers: { 'Cache-Control': `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}` },
    },
  );
}
