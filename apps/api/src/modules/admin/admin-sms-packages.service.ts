import { Injectable, NotFoundException } from '@nestjs/common';
import type { UpsertSmsPackageInput } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminSmsPackagesService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    return this.prisma.smsPackage.findMany({ orderBy: { credits: 'asc' } });
  }

  async upsert(actorUserId: string, input: UpsertSmsPackageInput) {
    const pkg = await this.prisma.smsPackage.upsert({
      where: { key: input.key },
      create: input,
      update: { name: input.name, credits: input.credits, price: input.price, isActive: input.isActive },
    });
    await this.prisma.auditLog.create({
      data: {
        studioId: null,
        userId: actorUserId,
        action: 'sms_package.upsert',
        entityType: 'SmsPackage',
        entityId: pkg.id,
        metadata: { key: input.key, credits: input.credits, price: input.price },
      },
    });
    return pkg;
  }

  async setActive(actorUserId: string, key: string, isActive: boolean) {
    const pkg = await this.prisma.smsPackage.findUnique({ where: { key } });
    if (!pkg) throw new NotFoundException('SMS paketi bulunamadı');
    const updated = await this.prisma.smsPackage.update({ where: { id: pkg.id }, data: { isActive } });
    await this.prisma.auditLog.create({
      data: { studioId: null, userId: actorUserId, action: 'sms_package.set_active', entityType: 'SmsPackage', entityId: pkg.id, metadata: { isActive } },
    });
    return updated;
  }
}
