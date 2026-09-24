import {
  GOOD_RATING_THRESHOLD,
  LOW_RATING_THRESHOLD,
  RATING_EDIT_WINDOW_HOURS,
  RATING_WINDOW_DAYS,
  RateBookingSchema,
  isValidGoogleReviewUrl,
  isWithinRatingEditWindow,
  isWithinRatingWindow,
} from './feedback';

describe('rating window rules', () => {
  const end = new Date('2026-01-01T10:00:00Z');

  it('rejects a rating before the session has ended', () => {
    const before = new Date('2026-01-01T09:00:00Z');
    expect(isWithinRatingWindow(end, before)).toBe(false);
  });

  it('accepts a rating right after the session ends', () => {
    const justAfter = new Date(end.getTime() + 60_000);
    expect(isWithinRatingWindow(end, justAfter)).toBe(true);
  });

  it('accepts a rating up to the 7-day deadline', () => {
    const deadline = new Date(end.getTime() + RATING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    expect(isWithinRatingWindow(end, deadline)).toBe(true);
  });

  it('rejects a rating past the 7-day deadline', () => {
    const late = new Date(end.getTime() + RATING_WINDOW_DAYS * 24 * 60 * 60 * 1000 + 60_000);
    expect(isWithinRatingWindow(end, late)).toBe(false);
  });
});

describe('rating edit window', () => {
  const createdAt = new Date('2026-01-01T10:00:00Z');

  it('allows editing right after creation', () => {
    expect(isWithinRatingEditWindow(createdAt, new Date(createdAt.getTime() + 60_000))).toBe(true);
  });

  it('allows editing up to the 24h deadline', () => {
    const deadline = new Date(createdAt.getTime() + RATING_EDIT_WINDOW_HOURS * 60 * 60 * 1000);
    expect(isWithinRatingEditWindow(createdAt, deadline)).toBe(true);
  });

  it('rejects editing after the 24h deadline', () => {
    const late = new Date(createdAt.getTime() + RATING_EDIT_WINDOW_HOURS * 60 * 60 * 1000 + 60_000);
    expect(isWithinRatingEditWindow(createdAt, late)).toBe(false);
  });
});

describe('score thresholds', () => {
  it('low threshold is 2 and good threshold is 4', () => {
    expect(LOW_RATING_THRESHOLD).toBe(2);
    expect(GOOD_RATING_THRESHOLD).toBe(4);
  });
});

describe('RateBookingSchema', () => {
  it('rejects a score outside 1-5', () => {
    expect(RateBookingSchema.safeParse({ score: 0 }).success).toBe(false);
    expect(RateBookingSchema.safeParse({ score: 6 }).success).toBe(false);
  });

  it('accepts a valid score with an optional comment', () => {
    const result = RateBookingSchema.safeParse({ score: 5, comment: 'Harika ders' });
    expect(result.success).toBe(true);
  });

  it('rejects a comment over 1000 characters', () => {
    const result = RateBookingSchema.safeParse({ score: 5, comment: 'a'.repeat(1001) });
    expect(result.success).toBe(false);
  });
});

describe('isValidGoogleReviewUrl', () => {
  it('accepts g.page links', () => {
    expect(isValidGoogleReviewUrl('https://g.page/r/abc123/review')).toBe(true);
  });

  it('accepts search.google.com/local/writereview links', () => {
    expect(isValidGoogleReviewUrl('https://search.google.com/local/writereview?placeid=abc')).toBe(true);
  });

  it('accepts google.com/maps links', () => {
    expect(isValidGoogleReviewUrl('https://www.google.com/maps/place/Studio')).toBe(true);
  });

  it('rejects an unrelated URL', () => {
    expect(isValidGoogleReviewUrl('https://example.com/review')).toBe(false);
  });
});
