import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@platform/database';
import {
  DASHBOARD_GRID,
  DashboardLayoutSchema,
  buildDefaultDashboardLayout,
  filterDashboardLayout,
  normalizeLayout,
} from '@platform/shared';
import type { DashboardLayout, DashboardLayoutResponseDTO } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../auth/tenant-context';
import { apiError } from '../../common/api-error';

/**
 * The caller's own overview board. Always scoped to the caller's membership
 * in the studio of the request (tenant.studioId + tenant.membershipId), so
 * nobody can read or write another membership's board. Every layout that
 * leaves this service is clamped to the card limits, compacted and limited
 * to the cards the caller may see right now.
 */
@Injectable()
export class DashboardLayoutService {
  constructor(private readonly prisma: PrismaService) {}

  async get(tenant: TenantContext): Promise<DashboardLayoutResponseDTO> {
    if (!tenant.membershipId) return this.defaultResponse(tenant);
    const row = await this.prisma.dashboardLayout.findFirst({
      where: { studioId: tenant.studioId, membershipId: tenant.membershipId },
    });
    if (!row) return this.defaultResponse(tenant);
    const parsed = DashboardLayoutSchema.safeParse(row.layout);
    // A row that no longer validates (a removed card key) falls back to the default instead of failing the page.
    if (!parsed.success) return this.defaultResponse(tenant);
    return {
      layout: this.sanitize(tenant, parsed.data),
      customized: true,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async save(tenant: TenantContext, userId: string, input: DashboardLayout): Promise<DashboardLayoutResponseDTO> {
    const membershipId = this.requireMembership(tenant);
    const layout = this.sanitize(tenant, input);
    const json = layout as unknown as Prisma.InputJsonValue;
    const row = await this.prisma.dashboardLayout.upsert({
      where: { membershipId },
      create: { studioId: tenant.studioId, membershipId, layout: json },
      update: { layout: json },
    });
    await this.prisma.auditLog.create({
      data: {
        studioId: tenant.studioId,
        userId,
        action: 'dashboard.layout.update',
        entityType: 'DashboardLayout',
        entityId: row.id,
        metadata: { itemCount: layout.items.length, widgets: layout.items.map((item) => item.widget) },
      },
    });
    return { layout, customized: true, updatedAt: row.updatedAt.toISOString() };
  }

  async reset(tenant: TenantContext, userId: string): Promise<DashboardLayoutResponseDTO> {
    const membershipId = this.requireMembership(tenant);
    const removed = await this.prisma.dashboardLayout.deleteMany({ where: { studioId: tenant.studioId, membershipId } });
    if (removed.count > 0) {
      await this.prisma.auditLog.create({
        data: { studioId: tenant.studioId, userId, action: 'dashboard.layout.reset', entityType: 'DashboardLayout', entityId: membershipId },
      });
    }
    return this.defaultResponse(tenant);
  }

  /** Clamp, compact and drop the cards the caller may not see. */
  private sanitize(tenant: TenantContext, layout: DashboardLayout): DashboardLayout {
    const items = filterDashboardLayout(normalizeLayout(layout.items), tenant.permissions, tenant.isOwner);
    return { version: DASHBOARD_GRID.version, items };
  }

  private defaultResponse(tenant: TenantContext): DashboardLayoutResponseDTO {
    return { layout: buildDefaultDashboardLayout(tenant.permissions, tenant.isOwner), customized: false, updatedAt: null };
  }

  private requireMembership(tenant: TenantContext): string {
    if (!tenant.membershipId) throw new ForbiddenException(apiError('apiErrors.dashboard.cannotSaveDashboardWithoutMembershipBusiness'));
    return tenant.membershipId;
  }
}
