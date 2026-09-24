import type { MemberDetailDTO } from '@platform/shared';

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

export const PACKAGE_STATUS_LABEL: Record<MemberPackageRow['status'], string> = {
  ACTIVE: 'Aktif',
  FROZEN: 'Donduruldu',
  EXPIRED: 'Süresi doldu',
  DEPLETED: 'Tükendi',
  CANCELLED: 'İptal',
};

export const BOOKING_STATUS_LABEL: Record<string, string> = {
  CONFIRMED: 'Onaylı',
  ATTENDED: 'Katıldı',
  CANCELLED_EARLY: 'İptal',
  CANCELLED_LATE: 'Geç iptal',
  NO_SHOW: 'Gelmedi',
  WAITLIST: 'Bekleme listesi',
};
