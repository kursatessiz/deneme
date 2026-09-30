import { Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { CreateAddOnSchema, SetAddOnPricesSchema, UpdateAddOnSchema } from '@platform/shared';
import type { CreateAddOnInput, SetAddOnPricesInput, UpdateAddOnInput } from '@platform/shared';
import { SuperAdminOnly } from '../../auth/decorators/super-admin-only.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/tenant-context';
import { ZodBody } from '../../../common/zod-body.pipe';
import { AdminAddOnsService } from './admin-add-ons.service';

/** Super admin: the add-on marketplace catalogue (G5c-2). Every write is audit logged. */
@Controller('admin/add-ons')
@SuperAdminOnly()
export class AdminAddOnsController {
  constructor(private readonly addOns: AdminAddOnsService) {}

  @Get()
  async list() {
    return { items: await this.addOns.list() };
  }

  /** Completed add-on payments per currency (never summed across currencies). */
  @Get('revenue')
  revenue() {
    return this.addOns.revenue();
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @ZodBody(CreateAddOnSchema) body: CreateAddOnInput) {
    return this.addOns.create(user.id, body);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ZodBody(UpdateAddOnSchema) body: UpdateAddOnInput) {
    return this.addOns.update(user.id, id, body);
  }

  @Put(':id/prices')
  setPrices(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ZodBody(SetAddOnPricesSchema) body: SetAddOnPricesInput) {
    return this.addOns.setPrices(user.id, id, body);
  }
}
