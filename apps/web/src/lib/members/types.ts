import type { MemberDetailDTO, Translate } from '@platform/shared';

export interface MemberPackageRow {
  id: string;
  packageDefinitionId: string;
  packageDefinition?: { name: string } | null;
  entitlementKind: 'SESSION_COUNT' | 'TIME_UNLIMITED' | 'CREDIT';
  totalUnits: number | null;
  usedUnits: number;
  remainingUnits: number | null;
  status: 'ACTIVE' | 'FROZEN' | 'EXPIRED' | 'DEPLETED' | 'CANCELLED';
  startDate: string;
  endDate: string;
  frozenUntil: string | null;
}

export interface MemberBookingRow {
  id: string;
  status: string;
  unitsCharged: number;
  createdAt: string;
  schedule?: {
    title: string;
    startTime: string;
    endTime: string;
    trainer?: { membership?: { user?: { firstName: string; lastName: string } } } | null;
  } | null;
}

export interface MemberPaymentRow {
  id: string;
  amount: string | number;
  currency: string;
  method: string;
  status: string;
  paidAt: string | null;
  invoiceStatus?: string | null;
}

export type MemberDetail = Omit<MemberDetailDTO, 'packages' | 'bookings' | 'payments'> & {
  homeBranchId?: string | null;
  packages: MemberPackageRow[];
  bookings: MemberBookingRow[];
  payments: MemberPaymentRow[];
};

/** Package status label; call with the active `useT()`/`getT()` translator. */
export function packageStatusLabel(t: Translate, status: MemberPackageRow['status']): string {
  return t(`members.packageStatus.${status}`);
}

/** Booking status label; reuses the same status set as the calendar detail panel. */
export function bookingStatusLabel(t: Translate, status: string): string {
  return t(`calendar.detail.status.${status}`);
}
