import { BASE_MESSAGES, createTranslator } from '@platform/shared';
import type { ScheduleSelfStatusDTO } from '@platform/shared';

import { availableAction, cancelConfirmation } from './sessionSelfService';

// Identity translator: the key plus its params, so the test pins which text is chosen.
const t = ((key: string, params?: Record<string, string | number>) => `${key}${params ? JSON.stringify(params) : ''}`) as Parameters<typeof cancelConfirmation>[1];

const status = (over: Partial<ScheduleSelfStatusDTO>): ScheduleSelfStatusDTO => ({ scheduleId: 's', isFull: false, booking: null, waitlist: null, ...over });
const booking = { bookingId: 'b', unitsCharged: 2, cancellation: { isLate: false, refundUnits: 2, penaltyUnits: 0, freeCancelHours: 12 } };

describe('cancelConfirmation', () => {
  it('falls back to a generic confirmation without a preview', () => {
    expect(cancelConfirmation(null, t)).toEqual({ title: 'mSessionBooking.cancel.confirmTitle', message: 'mSessionBooking.cancel.confirmGeneric' });
  });

  it('describes a free early cancellation with and without a refund', () => {
    expect(cancelConfirmation({ isLate: false, refundUnits: 2, penaltyUnits: 0, freeCancelHours: 12 }, t).message).toBe('mSessionBooking.cancel.early.refunded{"refund":2}');
    expect(cancelConfirmation({ isLate: false, refundUnits: 0, penaltyUnits: 0, freeCancelHours: 12 }, t).message).toBe('mSessionBooking.cancel.early.free');
  });

  it('flags a late cancellation and shows the penalty', () => {
    const noPenalty = cancelConfirmation({ isLate: true, refundUnits: 2, penaltyUnits: 0, freeCancelHours: 12 }, t);
    expect(noPenalty).toEqual({ title: 'mSessionBooking.cancel.confirmTitleLate', message: 'mSessionBooking.cancel.late.noPenalty' });
    expect(cancelConfirmation({ isLate: true, refundUnits: 0, penaltyUnits: 2, freeCancelHours: 12 }, t).message).toBe('mSessionBooking.cancel.late.penalty{"penalty":2}');
    expect(cancelConfirmation({ isLate: true, refundUnits: 1, penaltyUnits: 1, freeCancelHours: 12 }, t).message).toBe('mSessionBooking.cancel.late.penaltyRefunded{"penalty":1,"refund":1}');
  });

  it('renders real Turkish texts for every branch', () => {
    const tr = createTranslator({ locale: 'tr', messages: BASE_MESSAGES, fallback: BASE_MESSAGES });
    for (const c of [
      { isLate: false, refundUnits: 1, penaltyUnits: 0, freeCancelHours: 1 },
      { isLate: true, refundUnits: 1, penaltyUnits: 1, freeCancelHours: 1 },
    ]) {
      expect(cancelConfirmation(c, tr).message).not.toContain('mSessionBooking');
    }
  });
});

describe('availableAction', () => {
  it('offers booking, the waitlist, or nothing', () => {
    expect(availableAction(null)).toBe('NONE');
    expect(availableAction(status({}))).toBe('BOOK');
    expect(availableAction(status({ isFull: true }))).toBe('WAITLIST_JOIN');
    expect(availableAction(status({ isFull: true, waitlist: { waitlistId: 'w', placeInLine: 1, status: 'WAITING' } }))).toBe('NONE');
    expect(availableAction(status({ booking }))).toBe('NONE');
  });
});
