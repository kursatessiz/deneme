import { INTER_FACE } from '../interFaces';

const INTER_FACES: readonly string[] = Object.values(INTER_FACE);

/** The registered Inter face for a numeric or named font weight. */
export function faceForWeight(weight: string | number | undefined): string {
  switch (String(weight ?? '400')) {
    case '700':
    case '800':
    case '900':
    case 'bold':
      return INTER_FACE.bold;
    case '600':
      return INTER_FACE.semibold;
    case '500':
      return INTER_FACE.medium;
    default:
      return INTER_FACE.regular;
  }
}

/**
 * Picks the Inter face of a flattened text style. A fontWeight wins over a
 * family so `[fonts.body, { fontWeight: '700' }]` still renders bold; a
 * family that is not Inter (for example 'monospace') is left alone.
 */
export function resolveFace(fontFamily: string | undefined, fontWeight: string | number | undefined): string | null {
  if (fontFamily !== undefined && !INTER_FACES.includes(fontFamily)) return null;
  if (fontWeight !== undefined) return faceForWeight(fontWeight);
  return fontFamily ?? INTER_FACE.regular;
}
