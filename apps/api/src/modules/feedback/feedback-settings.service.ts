import { Injectable } from '@nestjs/common';
import type { FeedbackSettingsDTO, UpdateFeedbackSettingsInput } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FeedbackSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(studioId: string): Promise<FeedbackSettingsDTO> {
    const studio = await this.prisma.studio.findUniqueOrThrow({
      where: { id: studioId },
      select: { googleReviewUrl: true, referralRewardUnits: true },
    });
    return { googleReviewUrl: studio.googleReviewUrl, referralRewardUnits: studio.referralRewardUnits };
  }

  async update(studioId: string, actorUserId: string, input: UpdateFeedbackSettingsInput): Promise<FeedbackSettingsDTO> {
    const before = await this.get(studioId);
    const studio = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.studio.update({
        where: { id: studioId },
        data: {
          ...(input.googleReviewUrl !== undefined ? { googleReviewUrl: input.googleReviewUrl } : {}),
          ...(input.referralRewardUnits !== undefined ? { referralRewardUnits: input.referralRewardUnits } : {}),
        },
        select: { googleReviewUrl: true, referralRewardUnits: true },
      });
      await tx.auditLog.create({
        data: {
          studioId,
          userId: actorUserId,
          action: 'studio.feedback_settings.update',
          entityType: 'Studio',
          entityId: studioId,
          metadata: JSON.parse(JSON.stringify({ before, after: input })),
        },
      });
      return updated;
    });
    return { googleReviewUrl: studio.googleReviewUrl, referralRewardUnits: studio.referralRewardUnits };
  }
}
