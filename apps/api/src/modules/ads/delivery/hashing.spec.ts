import { createHash } from 'crypto';
import {
  hashEmail,
  hashExternalId,
  hashName,
  hashPhoneForGoogle,
  hashPhoneForMeta,
  normalizeEmailForHashing,
  normalizePhoneForGoogle,
  normalizePhoneForMeta,
  sha256Hex,
} from './hashing';

function ref(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

describe('hashing', () => {
  it('sha256Hex matches Node crypto directly (known vector)', () => {
    // Known SHA-256 test vector for the empty string.
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'.slice(0, 64));
  });

  it('normalises email to lowercase and trimmed before hashing', () => {
    expect(normalizeEmailForHashing('  Joe@Example.COM ')).toBe('joe@example.com');
    expect(normalizeEmailForHashing(null)).toBeNull();
    expect(normalizeEmailForHashing('')).toBeNull();
    expect(hashEmail('Joe@Example.com')).toBe(ref('joe@example.com'));
    expect(hashEmail(' joe@example.com ')).toBe(hashEmail('JOE@EXAMPLE.COM'));
  });

  it('normalises phone for Meta as E.164 digits with no plus sign', () => {
    expect(normalizePhoneForMeta('+905321112233')).toBe('905321112233');
    expect(normalizePhoneForMeta(' +90 532 111 22 33 ')).toBe('905321112233');
    expect(normalizePhoneForMeta(null)).toBeNull();
    expect(hashPhoneForMeta('+905321112233')).toBe(ref('905321112233'));
  });

  it('normalises phone for Google as E.164 with the plus sign kept', () => {
    expect(normalizePhoneForGoogle('+905321112233')).toBe('+905321112233');
    expect(normalizePhoneForGoogle('905321112233')).toBe('+905321112233');
    expect(hashPhoneForGoogle('+905321112233')).toBe(ref('+905321112233'));
    // Meta and Google hashes differ because of the leading "+".
    expect(hashPhoneForGoogle('+905321112233')).not.toBe(hashPhoneForMeta('+905321112233'));
  });

  it('hashes a name lowercased and trimmed, and a contact id deterministically', () => {
    expect(hashName(' Ayşe ')).toBe(ref('ayşe'));
    expect(hashName(null)).toBeNull();
    const id = '11111111-1111-1111-1111-111111111111';
    expect(hashExternalId(id)).toBe(ref(id));
    expect(hashExternalId(id)).toBe(hashExternalId(id));
  });
});
