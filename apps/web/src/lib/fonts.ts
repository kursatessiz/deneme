import { Archivo, Figtree, Fraunces, IBM_Plex_Sans, Manrope, Nunito_Sans, Schibsted_Grotesk } from 'next/font/google';
import type { ThemeFamilyKey } from '@platform/shared';

/**
 * Web fonts for the four theme families, loaded once at build time via
 * next/font (self-hosted, no runtime Google Fonts request). Each family's
 * `googleFonts` entry in packages/shared/src/design/themes.ts names the
 * same families; keep these in sync if that list changes.
 */
const noirDisplay = Schibsted_Grotesk({ subsets: ['latin'], weight: ['600', '800'], variable: '--font-noir-display' });
const noirBody = Figtree({ subsets: ['latin'], weight: ['400', '600'], variable: '--font-noir-body' });

const nefesDisplay = Fraunces({ subsets: ['latin'], weight: ['600'], variable: '--font-nefes-display' });
const nefesBody = Nunito_Sans({ subsets: ['latin'], weight: ['400', '700'], variable: '--font-nefes-body' });

const sahaDisplay = Archivo({ subsets: ['latin'], weight: ['700', '800'], variable: '--font-saha-display' });
const sahaBody = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '600'], variable: '--font-saha-body' });

const atolyeDisplay = Manrope({ subsets: ['latin'], weight: ['600', '800'], variable: '--font-atolye-display' });
const atolyeBody = Manrope({ subsets: ['latin'], weight: ['400', '600'], variable: '--font-atolye-body' });

export const FAMILY_FONT_VARIABLES: Record<ThemeFamilyKey, { display: string; body: string; className: string }> = {
  noir: { display: 'var(--font-noir-display)', body: 'var(--font-noir-body)', className: `${noirDisplay.variable} ${noirBody.variable}` },
  nefes: { display: 'var(--font-nefes-display)', body: 'var(--font-nefes-body)', className: `${nefesDisplay.variable} ${nefesBody.variable}` },
  saha: { display: 'var(--font-saha-display)', body: 'var(--font-saha-body)', className: `${sahaDisplay.variable} ${sahaBody.variable}` },
  atolye: { display: 'var(--font-atolye-display)', body: 'var(--font-atolye-body)', className: `${atolyeDisplay.variable} ${atolyeBody.variable}` },
};

/** classNames for every family's font variables, applied once on the dashboard root so switching family needs no reload. */
export const ALL_FONT_VARIABLE_CLASSES = Object.values(FAMILY_FONT_VARIABLES)
  .map((f) => f.className)
  .join(' ');
