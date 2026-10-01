/**
 * Review aggregate of a tenant site for its `LocalBusiness` structured data (S3, docs/SEO.md "AggregateRating").
 * Computed only from real member session ratings (SessionRating, docs/FEEDBACK_REFERRAL.md), published only
 * from five ratings up, and never invented: below the minimum there is no `aggregateRating` at all.
 */

/** Fewest ratings before an aggregate is published; fewer would be noise and looks fabricated. */
export const AGGREGATE_RATING_MIN_COUNT = 5;
/** Session ratings are 1 to 5 stars. */
export const AGGREGATE_RATING_BEST = 5;
export const AGGREGATE_RATING_WORST = 1;

export interface PublicAggregateRatingDTO {
  /** Mean score, rounded to one decimal. */
  ratingValue: number;
  reviewCount: number;
  bestRating: number;
}

/** Scores outside the 1..5 integer scale are not ratings and are ignored. */
export function validRatingScores(scores: readonly number[]): number[] {
  return scores.filter((s) => Number.isInteger(s) && s >= AGGREGATE_RATING_WORST && s <= AGGREGATE_RATING_BEST);
}

/** The aggregate from a rating count and the mean score (a database aggregate); null below the minimum. */
export function buildAggregateRating(count: number, average: number | null): PublicAggregateRatingDTO | null {
  if (!Number.isInteger(count) || count < AGGREGATE_RATING_MIN_COUNT) return null;
  if (average === null || !Number.isFinite(average) || average < AGGREGATE_RATING_WORST || average > AGGREGATE_RATING_BEST) return null;
  return { ratingValue: Math.round(average * 10) / 10, reviewCount: count, bestRating: AGGREGATE_RATING_BEST };
}

/** The aggregate of a list of scores; null when fewer than the minimum valid scores exist. */
export function aggregateRatingOf(scores: readonly number[]): PublicAggregateRatingDTO | null {
  const valid = validRatingScores(scores);
  if (valid.length === 0) return null;
  return buildAggregateRating(valid.length, valid.reduce((sum, s) => sum + s, 0) / valid.length);
}
