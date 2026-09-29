/** Pazarlama sigortaları (M3d): otomatik duraklatma nedenlerinin adları (pano, kampanya ekranı ve süper admin uyarıları). */
export const trMarketingGuards = {
  'marketingGuards.reason.BOUNCE': 'geri dönme (bounce)',
  'marketingGuards.reason.COMPLAINT': 'şikâyet',
} as const satisfies Record<string, string>;
