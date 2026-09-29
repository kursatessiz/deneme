import type { PayoutReconciliationStatusValue, PayoutStatusValue } from '@platform/shared';

export type PayoutTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export const PAYOUT_STATUS_TONE: Record<PayoutStatusValue, PayoutTone> = {
  PENDING: 'warning',
  IN_TRANSIT: 'info',
  PAID: 'success',
  FAILED: 'danger',
  CANCELED: 'neutral',
};

export const RECONCILIATION_TONE: Record<PayoutReconciliationStatusValue, PayoutTone> = {
  MATCHED: 'success',
  PARTIAL: 'warning',
  UNMATCHED: 'danger',
};
