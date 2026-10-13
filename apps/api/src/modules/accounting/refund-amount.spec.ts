import { refundAmountOf } from './accounting.service';

describe('refundAmountOf', () => {
  it('reads the refund amount', () => {
    expect(refundAmountOf({ amount: '120.00' })).toBe('120.00');
  });

  it('leaves out the part restored to a gift card', () => {
    expect(refundAmountOf({ amount: '120.00', giftCardCredit: '45.00' })).toBe('75.00');
  });

  it('returns null when the whole refund went back to the gift card', () => {
    expect(refundAmountOf({ amount: '50.00', giftCardCredit: '50.00' })).toBeNull();
  });

  it('ignores malformed metadata', () => {
    expect(refundAmountOf(null)).toBeNull();
    expect(refundAmountOf({ amount: 'abc' })).toBeNull();
  });
});
