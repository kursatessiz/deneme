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
