import type { ScheduleSelfStatusDTO, Translate } from '@platform/shared';

export type CancellationPreview = NonNullable<ScheduleSelfStatusDTO['booking']>['cancellation'];

export interface CancelConfirmation {
  title: string;
  message: string;
}

/**
 * Texts of the self-cancel confirmation. The preview comes from the API's dry run of the
 * business's own cancellation policy (GET /schedules/:id/self-status), so the member
 * learns before confirming whether this is an early or a late cancellation and what it costs.
 */
export function cancelConfirmation(cancellation: CancellationPreview | null, t: Translate): CancelConfirmation {
  if (!cancellation) {
    return { title: t('mSessionBooking.cancel.confirmTitle'), message: t('mSessionBooking.cancel.confirmGeneric') };
  }
  const { isLate, penaltyUnits, refundUnits } = cancellation;
  if (!isLate) {
    return {
      title: t('mSessionBooking.cancel.confirmTitle'),
      message: refundUnits > 0 ? t('mSessionBooking.cancel.early.refunded', { refund: refundUnits }) : t('mSessionBooking.cancel.early.free'),
    };
  }
  const title = t('mSessionBooking.cancel.confirmTitleLate');
  if (penaltyUnits <= 0) return { title, message: t('mSessionBooking.cancel.late.noPenalty') };
  return {
    title,
    message:
      refundUnits > 0
        ? t('mSessionBooking.cancel.late.penaltyRefunded', { penalty: penaltyUnits, refund: refundUnits })
        : t('mSessionBooking.cancel.late.penalty', { penalty: penaltyUnits }),
  };
}

export type SessionAction = 'BOOK' | 'WAITLIST_JOIN' | 'NONE';

/** What the detail screen offers the member for a session they are not booked into. */
export function availableAction(status: ScheduleSelfStatusDTO | null): SessionAction {
  if (!status || status.booking || status.waitlist) return 'NONE';
  return status.isFull ? 'WAITLIST_JOIN' : 'BOOK';
}
