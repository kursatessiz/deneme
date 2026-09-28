import { Controller, Get, Param } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface PublicAdsPixelsDTO {
  meta: { pixelId: string } | null;
  google: { conversionId: string } | null;
  tiktok: { pixelCode: string } | null;
}

/**
 * Public, unauthenticated: which ad platform pixels a tenant has active, so
 * the browser tracking client (apps/web/src/lib/tracking) knows whether to
 * load the Meta Pixel / Google tag on a public page at all. No secrets:
 * only the pixel/conversion id, which is meant to be public (it is already
 * visible in every page's network traffic once the pixel loads). The
 * client still gates loading on advertising consent itself.
 */
@Controller('public/studios')
export class PublicAdsConfigController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':slug/ads/pixels')
  async pixels(@Param('slug') slug: string): Promise<PublicAdsPixelsDTO> {
    const studio = await this.prisma.studio.findFirst({ where: { slug, isActive: true }, select: { id: true } });
    if (!studio) return { meta: null, google: null, tiktok: null };

    const connections = await this.prisma.adConnection.findMany({
      where: { studioId: studio.id, status: 'CONNECTED' },
      select: { platform: true, pixelOrDatasetId: true },
    });

    const meta = connections.find((c) => c.platform === 'META');
    const google = connections.find((c) => c.platform === 'GOOGLE');
    const tiktok = connections.find((c) => c.platform === 'TIKTOK');

    return {
      meta: meta?.pixelOrDatasetId ? { pixelId: meta.pixelOrDatasetId } : null,
      // The Google tag needs the account's conversion id (AW-XXXXXXXXX),
      // which is not part of the API's own OAuth credentials; until the
      // connection form collects it separately, the gtag load is skipped.
      google: null,
      tiktok: tiktok?.pixelOrDatasetId ? { pixelCode: tiktok.pixelOrDatasetId } : null,
    };
  }
}
