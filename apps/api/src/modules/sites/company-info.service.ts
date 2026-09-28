import { Injectable } from '@nestjs/common';
import type { UpdateCompanyInfoInput } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';

const SINGLETON_ID = 'platform';

/**
 * The platform's own legal identity (name, address, registry, tax info),
 * editable by super admin only. Not tenant data (no studioId); tenant sites
 * use their own Studio fields instead (docs/SAYFA_MOTORU.md).
 */
@Injectable()
export class CompanyInfoService {
  constructor(private readonly prisma: PrismaService) {}

  async get() {
    const row = await this.prisma.companyInfo.findUnique({ where: { id: SINGLETON_ID } });
    return (
      row ?? {
        id: SINGLETON_ID,
        legalName: '',
        address: null,
        tradeRegistryNo: null,
        mersisNo: null,
        taxOffice: null,
        taxNumber: null,
        email: null,
        phone: null,
        socialLinks: {},
        updatedAt: null,
      }
    );
  }

  async update(input: UpdateCompanyInfoInput) {
    return this.prisma.companyInfo.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, ...input },
      update: { ...input },
    });
  }
}
