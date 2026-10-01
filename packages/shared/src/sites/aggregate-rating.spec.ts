import { aggregateRatingOf, buildAggregateRating, validRatingScores } from './index';

describe('sites/aggregate rating', () => {
  it('publishes nothing below five ratings', () => {
    expect(aggregateRatingOf([])).toBeNull();
    expect(aggregateRatingOf([5, 5, 5, 5])).toBeNull();
    expect(buildAggregateRating(4, 5)).toBeNull();
  });

  it('computes the mean to one decimal with the real review count from five ratings on', () => {
    expect(aggregateRatingOf([5, 5, 4, 4, 5])).toEqual({ ratingValue: 4.6, reviewCount: 5, bestRating: 5 });
    expect(aggregateRatingOf([5, 5, 5, 5, 5, 5, 5])).toEqual({ ratingValue: 5, reviewCount: 7, bestRating: 5 });
    expect(aggregateRatingOf([1, 2, 3, 4, 5])).toEqual({ ratingValue: 3, reviewCount: 5, bestRating: 5 });
    expect(aggregateRatingOf([4, 4, 4, 4, 5, 5, 5])).toEqual({ ratingValue: 4.4, reviewCount: 7, bestRating: 5 });
  });

  it('ignores values that are not 1 to 5 whole-star ratings, and counts only the valid ones', () => {
    expect(validRatingScores([0, 1, 5, 6, 2.5, -1, 3, Number.NaN])).toEqual([1, 5, 3]);
    expect(aggregateRatingOf([5, 5, 5, 5, 0, 9, 3.5])).toBeNull();
    expect(aggregateRatingOf([5, 5, 5, 5, 4, 0, 9])).toEqual({ ratingValue: 4.8, reviewCount: 5, bestRating: 5 });
  });

  it('builds from a database count and mean, rejecting an impossible mean', () => {
    expect(buildAggregateRating(12, 4.333333)).toEqual({ ratingValue: 4.3, reviewCount: 12, bestRating: 5 });
    expect(buildAggregateRating(12, null)).toBeNull();
    expect(buildAggregateRating(12, 0)).toBeNull();
    expect(buildAggregateRating(12, 5.4)).toBeNull();
    expect(buildAggregateRating(5.5, 4)).toBeNull();
  });
});
