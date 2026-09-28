import { normalizePhone } from './phone';

describe('normalizePhone', () => {
  it.each([
    ['05321112233', '+905321112233'],
    ['5321112233', '+905321112233'],
    ['+90 (532) 111-22-33', '+905321112233'],
    ['0090 532 111 22 33', '+905321112233'],
    ['+44 20 7946 0958', '+442079460958'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(['', 'abc', '0532', '+90 532 111 22', '0999 111 22 33'])('rejects %s', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe('normalizePhone with a non-Turkish default country', () => {
  it('normalizes a US national number against a US default (ISO country code)', () => {
    expect(normalizePhone('(415) 555-2671', 'US')).toBe('+14155552671');
  });

  it('normalizes a German national number against a DE default', () => {
    expect(normalizePhone('030 83050', 'DE')).toBe('+493083050');
  });

  it('still accepts an explicit E.164 number regardless of the default country', () => {
    expect(normalizePhone('+14155552671', 'TR')).toBe('+14155552671');
  });

  it('rejects a national number that is invalid for the given default country', () => {
    expect(normalizePhone('123', 'US')).toBeNull();
  });
});
