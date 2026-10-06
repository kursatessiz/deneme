import { Controller, Get, NotFoundException, Put } from '@nestjs/common';
import { UpdateCompanyInfoSchema } from '@platform/shared';
import type { UpdateCompanyInfoInput } from '@platform/shared';
import { SuperAdminOnly } from '../auth/decorators/super-admin-only.decorator';
import { ZodBody } from '../../common/zod-body.pipe';
import { CompanyInfoService } from './company-info.service';
import { PrismaService } from '../prisma/prisma.service';
import { apiError } from '../../common/api-error';

/** The platform's own legal identity, edited from the super admin panel only. */
@Controller('admin/company-info')
@SuperAdminOnly()
export class CompanyInfoController {
  constructor(
    private readonly companyInfo: CompanyInfoService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async get() {
    return this.companyInfo.get();
  }

  @Put()
  async update(@ZodBody(UpdateCompanyInfoSchema) body: UpdateCompanyInfoInput) {
    return this.companyInfo.update(body);
  }

  /** The platform tenant's studioId, so the "Web sitesi" admin screen can call the tenant-scoped /sites/studio/:studioId routes. */
  @Get('platform-studio-id')
  async platformStudioId() {
    const studio = await this.prisma.studio.findFirst({ where: { isPlatform: true }, select: { id: true } });
    if (!studio) throw new NotFoundException(apiError('apiErrors.common.platformTenantNotFound'));
    return { studioId: studio.id };
  }
}
