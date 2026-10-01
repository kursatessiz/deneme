import { Injectable } from '@nestjs/common';
import { AGGREGATE_RATING_BEST, AGGREGATE_RATING_WORST, buildAggregateRating, type PublicAggregateRatingDTO } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';

const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 500;

/**
 * The review aggregate a tenant site publishes in its LocalBusiness structured data (docs/SEO.md
 * "AggregateRating"): the mean and count of the studio's own member session ratings (docs/FEEDBACK_REFERRAL.md),
 * from five ratings up, never invented. One aggregate query per studio, cached ten minutes in process (single
 * API instance, like the feed cache); a new rating shows within that window.
 */
@Injectable()
export class SiteAggregateRatingService {
  private readonly entries = new Map<string, { value: PublicAggregateRatingDTO | null; expiresAt: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async forStudio(studioId: string, now: number = Date.now()): Promise<PublicAggregateRatingDTO | null> {
    const cached = this.entries.get(studioId);
    if (cached && cached.expiresAt > now) return cached.value;
    // Always scoped to the studio (CLAUDE.md rule 4); only whole-star scores of the 1..5 scale count.
    const aggregate = await this.prisma.sessionRating.aggregate({
      where: { studioId, score: { gte: AGGREGATE_RATING_WORST, lte: AGGREGATE_RATING_BEST } },
      _count: { _all: true },
      _avg: { score: true },
    });
    const value = buildAggregateRating(aggregate._count._all, aggregate._avg.score);
    if (this.entries.size >= MAX_ENTRIES) this.entries.clear();
    this.entries.set(studioId, { value, expiresAt: now + TTL_MS });
    return value;
  }
}
