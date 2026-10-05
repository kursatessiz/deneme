import { z } from 'zod';
import type { ChurnLevelCountDTO } from '../churn';
import type { LowStockItemDTO } from '../retail';
import type { TrainerReportRowDTO } from '../types';
import { DASHBOARD_GRID } from './grid';
import { DashboardWidgetKeySchema, DashboardWidgetSettingsSchema } from './widgets';
import type { DashboardPeriod, DashboardWidgetKey } from './widgets';

/**
 * `POST /studios/:studioId/dashboard/data`: the figures of the cards on the
 * board, computed in one round trip. Each card is checked against the
 * caller's permissions on its own; a card the caller may not see comes back
 * as `forbidden` instead of failing the whole batch.
 */
export const DashboardDataRequestSchema = z
  .object({
    branchId: z.string().uuid().optional(),
    widgets: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            widget: DashboardWidgetKeySchema,
            settings: DashboardWidgetSettingsSchema.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(DASHBOARD_GRID.maxItems),
  })
  .strict();
export type DashboardDataRequest = z.infer<typeof DashboardDataRequestSchema>;

/** A figure compared with the previous period; `change` is a ratio (0.12 = +12%), null without a base. */
export interface DashboardComparisonDTO {
  period: DashboardPeriod;
  from: string;
  to: string;
  current: number;
  previous: number;
  change: number | null;
}

export interface DashboardSessionRowDTO {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  serviceTypeName: string | null;
  trainerName: string | null;
  resourceName: string | null;
  branchName: string | null;
  booked: number;
  capacity: number;
  isCancelled: boolean;
}

export interface DashboardPaymentRowDTO {
  id: string;
  paidAt: string | null;
  /** Masked like the payments list (first name and last initial) unless the caller has members.contact.view. */
  payerName: string | null;
  amount: string;
  currency: string;
  paymentMethod: string;
  paymentStatus: string;
}

export interface DashboardExpiringPackageRowDTO {
  memberPackageId: string;
  memberId: string;
  memberName: string;
  packageName: string;
  endDate: string;
  remainingUnits: number | null;
}

export interface DashboardBranchRowDTO {
  id: string;
  name: string;
  address: string | null;
  /** Last 30 days, only when the caller has reports.view. */
  summary: { sessions: number; occupancy: number; revenue: string; homeMembers: number } | null;
}

export interface DashboardEventRowDTO {
  id: string;
  title: string;
  startsAt: string | null;
  capacity: number;
  seatsTaken: number;
  status: string;
}

export type DashboardWidgetPayload =
  | ({ kind: 'revenue'; currency: string; currentAmount: string; previousAmount: string } & DashboardComparisonDTO)
  | { kind: 'activeMembers'; count: number; expiringPackages: number }
  | ({ kind: 'newMembers' } & DashboardComparisonDTO)
  | {
      kind: 'memberGrowth';
      period: DashboardPeriod;
      rate: number | null;
      previousRate: number | null;
      joined: number;
      churned: number;
      activeMembers: number;
    }
  | { kind: 'occupancy'; period: DashboardPeriod; rate: number; previousRate: number | null; booked: number; capacity: number }
  | { kind: 'todaySessions'; sessions: number; bookings: number; capacity: number; cancelled: number }
  | { kind: 'renewalRate'; period: DashboardPeriod; rate: number; previousRate: number | null; expired: number; renewed: number }
  | { kind: 'churnRisk'; counts: ChurnLevelCountDTO[]; computedAt: string | null }
  | ({ kind: 'newLeads' } & DashboardComparisonDTO)
  | { kind: 'revenueTrend'; period: DashboardPeriod; currency: string; total: string; points: { date: string; amount: string }[] }
  | { kind: 'occupancyTrend'; period: DashboardPeriod; points: { date: string; rate: number; booked: number; capacity: number }[] }
  | { kind: 'memberGrowthChart'; points: { month: string; joined: number }[] }
  | { kind: 'sessions'; from: string; to: string; sessions: DashboardSessionRowDTO[] }
  | { kind: 'recentPayments'; payments: DashboardPaymentRowDTO[] }
  | { kind: 'expiringPackages'; withinDays: number; packages: DashboardExpiringPackageRowDTO[] }
  | { kind: 'trainerPerformance'; period: DashboardPeriod; trainers: TrainerReportRowDTO[] }
  | { kind: 'branches'; currency: string; branches: DashboardBranchRowDTO[] }
  | { kind: 'lowStock'; items: LowStockItemDTO[] }
  | { kind: 'upcomingEvents'; events: DashboardEventRowDTO[] }
  | { kind: 'none' };

export type DashboardWidgetResultDTO =
  | { id: string; widget: DashboardWidgetKey; status: 'ok'; data: DashboardWidgetPayload }
  | { id: string; widget: DashboardWidgetKey; status: 'forbidden' }
  | { id: string; widget: DashboardWidgetKey; status: 'error' };

export interface DashboardDataResponseDTO {
  generatedAt: string;
  /** The studio's currency (ISO 4217); every amount above is in it. */
  currency: string;
  /** The studio's IANA time zone the periods were resolved in. */
  timeZone: string;
  results: DashboardWidgetResultDTO[];
}
