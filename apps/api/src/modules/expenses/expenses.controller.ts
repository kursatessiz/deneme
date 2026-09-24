import { Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CreateExpenseSchema, CreateExpenseInput, ListExpensesQuerySchema, ListExpensesQuery } from '@platform/shared';
import { ExpensesService } from './expenses.service';
import { RequirePermission, StudioScoped } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import { ZodBody, ZodQuery } from '../../common/zod-body.pipe';
import type { AuthUser, TenantContext } from '../auth/tenant-context';

@Controller('expenses')
@StudioScoped()
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get('studio/:studioId')
  @RequirePermission('finance.view')
  async list(@Tenant() tenant: TenantContext, @ZodQuery(ListExpensesQuerySchema) query: ListExpensesQuery) {
    return this.expenses.list(tenant, query);
  }

  @Post()
  @RequirePermission('finance.manage')
  async create(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @ZodBody(CreateExpenseSchema) body: CreateExpenseInput) {
    return this.expenses.create(tenant, user.id, body);
  }

  @Delete(':expenseId/studio/:studioId')
  @RequirePermission('finance.manage')
  async remove(@Param('expenseId', ParseUUIDPipe) expenseId: string, @Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser) {
    await this.expenses.remove(tenant, user.id, expenseId);
    return { success: true };
  }
}
