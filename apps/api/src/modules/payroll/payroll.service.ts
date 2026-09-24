import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@platform/database';
import type { AdjustPayrollLineInput, GeneratePayrollRunInput, ListPayrollRunsInput, PayrollLineDTO, PayrollRunDTO } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../auth/tenant-context';
import { assertBranchAccess, branchScope } from '../branches/branch-access';
import { calculateTrainerCommission } from './commission-calculator';
import type { CommissionBookingInput, CommissionSessionInput } from './commission-calculator';

const ATTENDANCE_RELEVANT_STATUSES = ['ATTENDED', 'NO_SHOW', 'CANCELLED_LATE'] as const;

@Injectable()
export class PayrollService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Generate / regenerate a draft run
  // ---------------------------------------------------------------------------

  async generate(tenant: TenantContext, actorUserId: string, input: GeneratePayrollRunInput): Promise<PayrollRunDTO> {
    if (input.branchId) assertBranchAccess(tenant, input.branchId);

    await this.assertNoApprovedOverlap(tenant.studioId, input.branchId ?? null, input.periodStart, input.periodEnd, null);

    const schedules = await this.prisma.sessionSchedule.findMany({
      where: {
        studioId: tenant.studioId,
        ...(input.branchId ? { branchId: input.branchId } : {}),
        isCancelled: false,
        // The teaching trainer earns the session; a substituted-out trainer
        // (originalTrainerId) never appears here.
        trainerId: { not: null },
        startTime: { gte: input.periodStart, lt: input.periodEnd },
      },
      include: {
        serviceType: { include: { commissionRule: true } },
        trainer: { include: { commissionRule: true, membership: { include: { user: true } } } },
        bookings: {
          where: { status: { in: [...ATTENDANCE_RELEVANT_STATUSES] } },
          include: { memberPackage: { include: { packageDefinition: true } } },
        },
      },
    });

    const byTrainer = new Map<string, { trainerName: string; sessions: CommissionSessionInput[] }>();
    for (const schedule of schedules) {
      if (!schedule.trainerId || !schedule.trainer) continue;
      const bookings: CommissionBookingInput[] = schedule.bookings.map((b) => ({
        bookingId: b.id,
        status: b.status,
        unitsCharged: b.unitsCharged,
        penaltyUnits: b.penaltyUnits,
        package: b.memberPackage
          ? {
              price: b.memberPackage.packageDefinition.price,
              entitlementKind: b.memberPackage.entitlementKind,
              totalUnits: b.memberPackage.totalUnits,
              validityDays: b.memberPackage.packageDefinition.validityDays,
            }
          : null,
      }));

      const session: CommissionSessionInput = {
        scheduleId: schedule.id,
        serviceTypeName: schedule.serviceType.name,
        startTime: schedule.startTime,
        serviceTypeRule: schedule.serviceType.commissionRule
          ? { id: schedule.serviceType.commissionRule.id, type: schedule.serviceType.commissionRule.type, value: schedule.serviceType.commissionRule.value }
          : null,
        trainerRule: schedule.trainer.commissionRule
          ? { id: schedule.trainer.commissionRule.id, type: schedule.trainer.commissionRule.type, value: schedule.trainer.commissionRule.value }
          : null,
        bookings,
      };

      const entry = byTrainer.get(schedule.trainerId) ?? {
        trainerName: `${schedule.trainer.membership.user.firstName} ${schedule.trainer.membership.user.lastName}`,
        sessions: [],
      };
      entry.sessions.push(session);
      byTrainer.set(schedule.trainerId, entry);
    }

    const lineInputs = [...byTrainer.entries()].map(([trainerProfileId, { sessions }]) => {
      const result = calculateTrainerCommission(sessions);
      return {
        trainerProfileId,
        sessions: result.sessions,
        attendees: result.attendees,
        grossAmount: result.grossAmount,
        details: result.details.map((d) => ({
          scheduleId: d.scheduleId,
          bookingId: d.bookingId,
          serviceTypeName: d.serviceTypeName,
          startTime: d.startTime.toISOString(),
          ruleType: d.ruleType,
          ruleSource: d.ruleSource,
          units: d.units,
          unitPrice: d.unitPrice ? d.unitPrice.toFixed(2) : null,
          amount: d.amount.toFixed(2),
        })),
      };
    });

    const totalGross = lineInputs.reduce((acc, l) => acc.add(l.grossAmount), new Prisma.Decimal(0));

    const run = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.payrollRun.findFirst({
        where: {
          studioId: tenant.studioId,
          branchId: input.branchId ?? null,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          status: 'DRAFT',
        },
      });

      const runRow = existing
        ? await tx.payrollRun.update({
            where: { id: existing.id },
            data: { totalGross, totalAdjustments: 0, totalNet: totalGross },
          })
        : await tx.payrollRun.create({
            data: {
              studioId: tenant.studioId,
              branchId: input.branchId ?? null,
              periodStart: input.periodStart,
              periodEnd: input.periodEnd,
              status: 'DRAFT',
              totalGross,
              totalAdjustments: 0,
              totalNet: totalGross,
              createdByUserId: actorUserId,
            },
          });

      if (existing) {
        await tx.payrollLine.deleteMany({ where: { runId: existing.id } });
      }

      if (lineInputs.length > 0) {
        await tx.payrollLine.createMany({
          data: lineInputs.map((l) => ({
            runId: runRow.id,
            studioId: tenant.studioId,
            trainerProfileId: l.trainerProfileId,
            sessions: l.sessions,
            attendees: l.attendees,
            grossAmount: l.grossAmount,
            adjustments: 0,
            netAmount: l.grossAmount,
            lines: l.details,
          })),
        });
      }

      return runRow;
    });

    return this.getRun(tenant, run.id);
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async list(tenant: TenantContext, filter: ListPayrollRunsInput): Promise<PayrollRunDTO[]> {
    if (filter.branchId) assertBranchAccess(tenant, filter.branchId);
    const runs = await this.prisma.payrollRun.findMany({
      where: {
        studioId: tenant.studioId,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.branchId ? { branchId: filter.branchId } : branchScope(tenant)),
      },
      orderBy: [{ periodStart: 'desc' }],
    });
    return runs.map(toRunDTO);
  }

  async getRun(tenant: TenantContext, runId: string): Promise<PayrollRunDTO> {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id: runId, studioId: tenant.studioId },
      include: {
        lines: {
          include: { trainerProfile: { include: { membership: { include: { user: true } } } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!run) throw new NotFoundException('Bordro dönemi bulunamadı');
    assertBranchAccess(tenant, run.branchId);
    return { ...toRunDTO(run), lines: run.lines.map(toLineDTO) };
  }

  /** Trainer's own lines across APPROVED/PAID runs. */
  async myLines(tenant: TenantContext): Promise<PayrollLineDTO[]> {
    if (!tenant.trainerProfileId) throw new ForbiddenException('Bu görünüm yalnızca eğitmenler içindir');
    const lines = await this.prisma.payrollLine.findMany({
      where: {
        studioId: tenant.studioId,
        trainerProfileId: tenant.trainerProfileId,
        run: { status: { in: ['APPROVED', 'PAID'] } },
      },
      include: { trainerProfile: { include: { membership: { include: { user: true } } } }, run: true },
      orderBy: { createdAt: 'desc' },
    });
    return lines.map(toLineDTO);
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  async adjustLine(tenant: TenantContext, runId: string, lineId: string, input: AdjustPayrollLineInput): Promise<PayrollLineDTO> {
    const run = await this.requireDraftRun(tenant, runId);
    const line = await this.prisma.payrollLine.findFirst({ where: { id: lineId, runId: run.id } });
    if (!line) throw new NotFoundException('Bordro satırı bulunamadı');

    const adjustment = new Prisma.Decimal(input.amount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const newAdjustments = new Prisma.Decimal(line.adjustments).add(adjustment);
    const newNet = new Prisma.Decimal(line.grossAmount).add(newAdjustments);
    const note = line.note ? `${line.note}\n${input.note}` : input.note;

    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedLine = await tx.payrollLine.update({
        where: { id: line.id },
        data: { adjustments: newAdjustments, netAmount: newNet, note },
        include: { trainerProfile: { include: { membership: { include: { user: true } } } } },
      });
      await this.recomputeRunTotals(tx, run.id);
      return updatedLine;
    });

    return toLineDTO(updated);
  }

  async approve(tenant: TenantContext, actorUserId: string, runId: string): Promise<PayrollRunDTO> {
    const run = await this.requireDraftRun(tenant, runId);
    await this.assertNoApprovedOverlap(tenant.studioId, run.branchId, run.periodStart, run.periodEnd, run.id);

    await this.prisma.payrollRun.update({
      where: { id: run.id },
      data: { status: 'APPROVED', approvedByUserId: actorUserId, approvedAt: new Date() },
    });
    return this.getRun(tenant, run.id);
  }

  async markPaid(tenant: TenantContext, runId: string): Promise<PayrollRunDTO> {
    const run = await this.prisma.payrollRun.findFirst({ where: { id: runId, studioId: tenant.studioId } });
    if (!run) throw new NotFoundException('Bordro dönemi bulunamadı');
    assertBranchAccess(tenant, run.branchId);
    if (run.status !== 'APPROVED') {
      throw new BadRequestException('Yalnızca onaylanmış bordrolar ödendi olarak işaretlenebilir');
    }
    await this.prisma.payrollRun.update({ where: { id: run.id }, data: { status: 'PAID', paidAt: new Date() } });
    return this.getRun(tenant, run.id);
  }

  async exportCsv(tenant: TenantContext, runId: string): Promise<string> {
    const run = await this.getRun(tenant, runId);
    const rows = [['Eğitmen', 'Seans', 'Katılımcı', 'Brüt', 'Düzeltme', 'Net']];
    for (const line of run.lines ?? []) {
      rows.push([line.trainerFullName, String(line.sessions), String(line.attendees), line.grossAmount, line.adjustments, line.netAmount]);
    }
    const body = rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
    // UTF-8 BOM so Excel on Windows opens Turkish characters correctly.
    return `﻿${body}\r\n`;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async requireDraftRun(tenant: TenantContext, runId: string) {
    const run = await this.prisma.payrollRun.findFirst({ where: { id: runId, studioId: tenant.studioId } });
    if (!run) throw new NotFoundException('Bordro dönemi bulunamadı');
    assertBranchAccess(tenant, run.branchId);
    if (run.status !== 'DRAFT') {
      throw new ConflictException('Onaylanmış veya ödenmiş bordro değiştirilemez');
    }
    return run;
  }

  private async recomputeRunTotals(tx: Prisma.TransactionClient, runId: string): Promise<void> {
    const agg = await tx.payrollLine.aggregate({
      where: { runId },
      _sum: { grossAmount: true, adjustments: true, netAmount: true },
    });
    await tx.payrollRun.update({
      where: { id: runId },
      data: {
        totalGross: agg._sum.grossAmount ?? 0,
        totalAdjustments: agg._sum.adjustments ?? 0,
        totalNet: agg._sum.netAmount ?? 0,
      },
    });
  }

  /** Rejects generating/approving a run whose period overlaps an already-approved run for the same branch. */
  private async assertNoApprovedOverlap(
    studioId: string,
    branchId: string | null,
    periodStart: Date,
    periodEnd: Date,
    excludeRunId: string | null,
  ): Promise<void> {
    const overlapping = await this.prisma.payrollRun.findFirst({
      where: {
        studioId,
        branchId,
        status: { in: ['APPROVED', 'PAID'] },
        ...(excludeRunId ? { id: { not: excludeRunId } } : {}),
        periodStart: { lt: periodEnd },
        periodEnd: { gt: periodStart },
      },
    });
    if (overlapping) {
      throw new ConflictException('Bu şube için aynı döneme çakışan onaylanmış bir bordro zaten var');
    }
  }
}

function csvCell(value: string): string {
  const escaped = value.replace(/"/g, '""');
  return /[";\n]/.test(value) ? `"${escaped}"` : escaped;
}

function toRunDTO(run: {
  id: string;
  studioId: string;
  branchId: string | null;
  periodStart: Date;
  periodEnd: Date;
  status: string;
  totalGross: Prisma.Decimal;
  totalAdjustments: Prisma.Decimal;
  totalNet: Prisma.Decimal;
  createdByUserId: string;
  approvedByUserId: string | null;
  approvedAt: Date | null;
  paidAt: Date | null;
  createdAt: Date;
}): PayrollRunDTO {
  return {
    id: run.id,
    studioId: run.studioId,
    branchId: run.branchId,
    periodStart: run.periodStart.toISOString(),
    periodEnd: run.periodEnd.toISOString(),
    status: run.status as PayrollRunDTO['status'],
    totalGross: run.totalGross.toFixed(2),
    totalAdjustments: run.totalAdjustments.toFixed(2),
    totalNet: run.totalNet.toFixed(2),
    createdByUserId: run.createdByUserId,
    approvedByUserId: run.approvedByUserId,
    approvedAt: run.approvedAt ? run.approvedAt.toISOString() : null,
    paidAt: run.paidAt ? run.paidAt.toISOString() : null,
    createdAt: run.createdAt.toISOString(),
  };
}

function toLineDTO(line: {
  id: string;
  runId: string;
  trainerProfileId: string;
  sessions: number;
  attendees: number;
  grossAmount: Prisma.Decimal;
  adjustments: Prisma.Decimal;
  netAmount: Prisma.Decimal;
  note: string | null;
  lines: Prisma.JsonValue;
  trainerProfile: { membership: { user: { firstName: string; lastName: string } } };
}): PayrollLineDTO {
  return {
    id: line.id,
    runId: line.runId,
    trainerProfileId: line.trainerProfileId,
    trainerFullName: `${line.trainerProfile.membership.user.firstName} ${line.trainerProfile.membership.user.lastName}`,
    sessions: line.sessions,
    attendees: line.attendees,
    grossAmount: line.grossAmount.toFixed(2),
    adjustments: line.adjustments.toFixed(2),
    netAmount: line.netAmount.toFixed(2),
    note: line.note,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON detail blob written by this service only.
    lines: (line.lines as any) ?? [],
  };
}
