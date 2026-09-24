import { z } from 'zod';
import type { EntitlementKind } from './enums';

/**
 * "Hesabım" (my account) widgets and calendar: upcoming bookings and
 * package summaries across every studio the caller belongs to, plus the
 * personal ICS calendar feed. Always scoped to the authenticated user; no
 * endpoint here accepts another user's id.
 */

export interface UpcomingBookingDTO {
  bookingId: string;
  studioId: string;
  studioName: string;
  branchName?: string | null;
  serviceName: string;
  startTime: string;
  endTime: string;
  trainerName?: string | null;
  resourceNames: string[];
}

export interface MeUpcomingBookingsDTO {
  items: UpcomingBookingDTO[];
}

export interface ActivePackageSummaryDTO {
  memberPackageId: string;
  studioId: string;
  studioName: string;
  packageName: string;
  entitlementKind: EntitlementKind;
  remainingUnits: number | null;
  endDate: string;
}

export interface StudioMembershipSummaryDTO {
  studioId: string;
  studioName: string;
  nextBooking?: UpcomingBookingDTO | null;
  activePackages: ActivePackageSummaryDTO[];
}

export interface MeSummaryDTO {
  nextBooking?: UpcomingBookingDTO | null;
  studios: StudioMembershipSummaryDTO[];
}

/** POST /me/calendar-feed response: the raw token is shown only once. */
export interface CalendarFeedCreatedDTO {
  url: string;
  webcalUrl: string;
  createdAt: string;
}

export const CalendarFeedTokenParamSchema = z
  .object({
    token: z.string().regex(/^[a-f0-9]{64}$/, 'Geçersiz takvim token'),
  })
  .strict();
export type CalendarFeedTokenParam = z.infer<typeof CalendarFeedTokenParamSchema>;
