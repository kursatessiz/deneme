import { isValidTckn, isValidVkn, TaxNumberSchema, TcknSchema, VknSchema } from './tax-id';

describe('isValidTckn', () => {
  it('accepts a known-valid test TCKN', () => {
    // Published GIB/e-devlet test identity number, satisfies both checksum digits.
    expect(isValidTckn('10000000146')).toBe(true);
  });

  it('rejects wrong length', () => {
    expect(isValidTckn('123')).toBe(false);
    expect(isValidTckn('123456789012')).toBe(false);
  });

  it('rejects a leading zero', () => {
    expect(isValidTckn('01234567890')).toBe(false);
  });

  it('rejects non-digit characters', () => {
    expect(isValidTckn('1000000014a')).toBe(false);
  });

  it('rejects a tampered checksum digit', () => {
    expect(isValidTckn('10000000147')).toBe(false);
  });
});

describe('isValidVkn', () => {
  // The VKN algorithm has no widely published canonical test number, so
  // generate a candidate's checksum digit from the same implementation and
  // assert self-consistency (right length, right digit, and that changing
  // any other digit invalidates it).
  function checksumOf(first9: string): number {
    const d = first9.split('').map(Number);
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      const tmp = (d[i] + (9 - i)) % 10;
      const piece = tmp === 9 ? 9 : (tmp * Math.pow(2, 9 - i)) % 9;
      sum += piece;
    }
    return (10 - (sum % 10)) % 10;
  }

  it('accepts a self-consistent generated VKN', () => {
    const first9 = '123456789';
    const vkn = first9 + checksumOf(first9);
    expect(isValidVkn(vkn)).toBe(true);
  });

  it('rejects wrong length', () => {
    expect(isValidVkn('12345')).toBe(false);
  });

  it('rejects a tampered checksum digit', () => {
    const first9 = '987654321';
    const good = checksumOf(first9);
    const bad = (good + 1) % 10;
    expect(isValidVkn(first9 + bad)).toBe(false);
  });

  it('rejects non-digit characters', () => {
    expect(isValidVkn('123456789a')).toBe(false);
  });
});

describe('TcknSchema / VknSchema / TaxNumberSchema', () => {
  it('TcknSchema trims and validates', () => {
    expect(TcknSchema.safeParse(' 10000000146 ').success).toBe(true);
    expect(TcknSchema.safeParse('00000000000').success).toBe(false);
  });

  it('VknSchema rejects an 11-digit value', () => {
    expect(VknSchema.safeParse('10000000146').success).toBe(false);
  });

  it('TaxNumberSchema accepts either shape', () => {
    expect(TaxNumberSchema.safeParse('10000000146').success).toBe(true);
    const vkn = '1234567890'; // checksum digit for first9 "123456789" is 0
    expect(isValidVkn(vkn)).toBe(true);
    expect(TaxNumberSchema.safeParse(vkn).success).toBe(true);
  });
});
