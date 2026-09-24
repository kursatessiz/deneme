import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@platform/database';
import type { CreateExpenseInput, ExpenseDTO, ListExpensesQuery } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../auth/tenant-context';
import { assertBranchAccess, branchScope } from '../branches/branch-access';

type ExpenseWithCreator = Prisma.ExpenseGetPayload<{ include: { createdBy: true } }>;

function toDto(expense: ExpenseWithCreator): ExpenseDTO {
  return {
    id: expense.id,
    studioId: expense.studioId,
    branchId: expense.branchId,
    category: expense.category,
    amount: expense.amount.toFixed(2),
    spentAt: expense.spentAt.toISOString(),
    note: expense.note,
    createdByUserId: expense.createdByUserId,
    createdByName: expense.createdBy ? `${expense.createdBy.firstName} ${expense.createdBy.lastName}`.trim() : null,
    createdAt: expense.createdAt.toISOString(),
  };
}

/** Studio expenses (W2.4): a simple, tenant- and branch-scoped ledger of spend, feeding the finance screen and audit trail. */
@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenant: TenantContext, query: ListExpensesQuery): Promise<ExpenseDTO[]> {
    const branch = branchScope(tenant, query.branchId);
    const expenses = await this.prisma.expense.findMany({
      where: {
        studioId: tenant.studioId,
        ...branch,
        ...(query.category ? { category: query.category } : {}),
        ...(query.from || query.to
          ? {
              spentAt: {
                ...(query.from ? { gte: query.from } : {}),
                ...(query.to ? { lte: query.to } : {}),
              },
            }
          : {}),
      },
      include: { createdBy: true },
      orderBy: { spentAt: 'desc' },
    });
    return expenses.map(toDto);
  }

  async create(tenant: TenantContext, actorUserId: string, input: CreateExpenseInput): Promise<ExpenseDTO> {
    if (input.branchId) assertBranchAccess(tenant, input.branchId);

    const [expense] = await this.prisma.$transaction([
      this.prisma.expense.create({
        data: {
          studioId: tenant.studioId,
          branchId: input.branchId ?? null,
          category: input.category,
          amount: new Prisma.Decimal(input.amount.toFixed(2)),
          spentAt: new Date(input.spentAt),
          note: input.note ?? null,
          createdByUserId: actorUserId,
        },
        include: { createdBy: true },
      }),
      this.prisma.auditLog.create({
        data: {
          studioId: tenant.studioId,
          userId: actorUserId,
          action: 'expense.create',
          entityType: 'Expense',
          metadata: { category: input.category, amount: input.amount, branchId: input.branchId ?? null },
        },
      }),
    ]);
    return toDto(expense);
  }

  async remove(tenant: TenantContext, actorUserId: string, expenseId: string): Promise<void> {
    const expense = await this.prisma.expense.findFirst({ where: { id: expenseId, studioId: tenant.studioId } });
    if (!expense) throw new NotFoundException('Gider bulunamadı');
    if (expense.branchId) assertBranchAccess(tenant, expense.branchId);
    if (tenant.branchIds !== null && !expense.branchId) {
      // Branch-restricted staff may not delete a studio-wide (no-branch) expense.
      throw new ForbiddenException('Bu gideri silme yetkiniz yok');
    }

    await this.prisma.$transaction([
      this.prisma.expense.delete({ where: { id: expenseId } }),
      this.prisma.auditLog.create({
        data: {
          studioId: tenant.studioId,
          userId: actorUserId,
          action: 'expense.delete',
          entityType: 'Expense',
          entityId: expenseId,
          metadata: { category: expense.category, amount: expense.amount.toFixed(2), branchId: expense.branchId },
        },
      }),
    ]);
  }
}
