import { parseRevalidateTags, secretsMatch } from './revalidate';

describe('secretsMatch', () => {
  it('accepts the exact secret only', () => {
    expect(secretsMatch('s3cret-s3cret-s3cret', 's3cret-s3cret-s3cret')).toBe(true);
    expect(secretsMatch('s3cret-s3cret-s3cret!', 's3cret-s3cret-s3cret')).toBe(false);
    expect(secretsMatch('', 's3cret-s3cret-s3cret')).toBe(false);
    expect(secretsMatch(null, 's3cret-s3cret-s3cret')).toBe(false);
  });
});

describe('parseRevalidateTags', () => {
  it('keeps only site cache tags, deduplicated', () => {
    expect(parseRevalidateTags({ tags: ['site:zen', 'site:zen', 'site:platform'] })).toEqual(['site:zen', 'site:platform']);
    expect(parseRevalidateTags({ tags: ['site:zen', 'other', '*'] })).toEqual(['site:zen']);
  });

  it('rejects bodies that are not a non-empty tag list or hold no site tag', () => {
    expect(parseRevalidateTags(null)).toBeNull();
    expect(parseRevalidateTags({})).toBeNull();
    expect(parseRevalidateTags({ tags: [] })).toBeNull();
    expect(parseRevalidateTags({ tags: ['other'] })).toBeNull();
    expect(parseRevalidateTags({ tags: ['site:zen', 3] })).toBeNull();
    expect(parseRevalidateTags({ tags: Array.from({ length: 21 }, (_, i) => `site:s${i}`) })).toBeNull();
  });
});
