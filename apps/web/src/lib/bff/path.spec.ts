import { sanitizeApiPath } from './path';

describe('sanitizeApiPath', () => {
  it('joins plain segments with a slash', () => {
    expect(sanitizeApiPath(['auth', 'me'])).toBe('auth/me');
    expect(sanitizeApiPath(['members', 'studio', 'abc-123'])).toBe('members/studio/abc-123');
  });

  it('rejects undefined or empty segment lists', () => {
    expect(sanitizeApiPath(undefined)).toBeNull();
    expect(sanitizeApiPath([])).toBeNull();
  });

  it('rejects path traversal', () => {
    expect(sanitizeApiPath(['..', 'etc', 'passwd'])).toBeNull();
    expect(sanitizeApiPath(['members', '..', 'auth'])).toBeNull();
    expect(sanitizeApiPath(['.'])).toBeNull();
  });

  it('rejects a segment that smuggles a slash or backslash', () => {
    expect(sanitizeApiPath(['members/../auth'])).toBeNull();
    expect(sanitizeApiPath(['members\\..\\auth'])).toBeNull();
  });

  it('rejects a segment that would let the browser choose a host', () => {
    expect(sanitizeApiPath(['https:', 'evil.example.com'])).toBeNull();
  });

  it('rejects an empty segment', () => {
    expect(sanitizeApiPath(['members', '', 'studio'])).toBeNull();
  });

  it('accepts uuids and query-safe tokens', () => {
    expect(sanitizeApiPath(['schedules', '11111111-1111-1111-1111-111111111111', 'spots'])).toBe(
      'schedules/11111111-1111-1111-1111-111111111111/spots',
    );
  });
});
