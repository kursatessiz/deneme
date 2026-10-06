import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@platform/database';
import {
  DEFAULT_PLATFORM_ROLE_TEMPLATES,
  platformSystemRoleKey,
  resolvePlatformPermissions,
  resolvePlatformTenantPermissions,
} from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { apiError } from '../../common/api-error';

type Tx = Prisma.TransactionClient;

/**
 * Single writer of platform access (docs/PAZARLAMA_MODULU.md 2.4):
 * - mirrors each platform role template to a locked system RoleTemplate
 *   `platform:<key>` in the platform tenant, whose permissions are derived
 *   through PLATFORM_TENANT_GRANTS;
 * - keeps, for every ACTIVE PlatformMembership, a Membership in the platform
 *   tenant on that system role (created/updated on activation, PASSIVE on
 *   revocation), in the same transaction as the platform record.
 * StudioTenantGuard additionally checks the PlatformMembership on every
 * request, so access never outlives a revocation even if a sync failed.
 * Audit entries are written by the callers, which know the actor.
 */
@Injectable()
export class PlatformAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Idempotent: default platform role templates and the access policy row (the migration seeds both; this repairs a wiped table). */
  async ensureDefaults(): Promise<void> {
    for (const template of DEFAULT_PLATFORM_ROLE_TEMPLATES) {
      const existing = await this.prisma.platformRoleTemplate.findUnique({ where: { key: template.key } });
      if (existing) continue;
      await this.prisma.platformRoleTemplate
        .create({
          data: {
            key: template.key,
            name: template.name,
            isSystem: true,
            permissions: { create: template.permissions.map((permissionKey) => ({ permissionKey })) },
          },
        })
        .catch(() => undefined); // A concurrent request created it first.
    }
    await this.prisma.platformAccessSettings.upsert({ where: { id: 'platform' }, create: { id: 'platform' }, update: {} });
  }

  async platformStudio(tx: Tx | PrismaService = this.prisma) {
    const studio = await tx.studio.findFirst({
      where: { isPlatform: true },
      select: { id: true, name: true, currency: true, defaultLocale: true },
    });
    if (!studio) throw new NotFoundException(apiError('apiErrors.common.platformTenantNotFound'));
    return studio;
  }

  /** Creates or refreshes the locked mirror of a platform role template inside the platform tenant. */
  async syncSystemRoleTemplate(tx: Tx, platformStudioId: string, platformRoleTemplateId: string): Promise<string> {
    const template = await tx.platformRoleTemplate.findUniqueOrThrow({
      where: { id: platformRoleTemplateId },
      include: { permissions: true },
    });
    const tenantKeys = resolvePlatformTenantPermissions(resolvePlatformPermissions(template.permissions.map((p) => p.permissionKey)));
    const key = platformSystemRoleKey(template.key);
    const role = await tx.roleTemplate.upsert({
      where: { studioId_key: { studioId: platformStudioId, key } },
      create: { studioId: platformStudioId, key, name: template.name, isOwner: false, isSystem: true },
      update: { name: template.name, isOwner: false, isSystem: true },
    });
    await tx.roleTemplatePermission.deleteMany({ where: { roleTemplateId: role.id } });
    if (tenantKeys.length > 0) {
      await tx.roleTemplatePermission.createMany({ data: tenantKeys.map((permissionKey) => ({ roleTemplateId: role.id, permissionKey })) });
    }
    return role.id;
  }

  /** The system RoleTemplate id for a platform role template (created on first use). */
  async systemRoleTemplateId(platformRoleTemplateId: string): Promise<string> {
    const studio = await this.platformStudio();
    return this.prisma.$transaction((tx) => this.syncSystemRoleTemplate(tx, studio.id, platformRoleTemplateId));
  }

  /**
   * Makes the user's PlatformMembership ACTIVE and writes the platform
   * tenant Membership on the system role. Returns that membership's id.
   */
  async activateInTx(tx: Tx, userId: string): Promise<{ membershipId: string; platformStudioId: string }> {
    const pm = await tx.platformMembership.findUnique({ where: { userId } });
    if (!pm) throw new NotFoundException(apiError('apiErrors.platformAccess.platformMembershipNotFound'));
    const studio = await this.platformStudio(tx);
    const roleTemplateId = await this.syncSystemRoleTemplate(tx, studio.id, pm.roleTemplateId);
    const now = new Date();

    const existing = await tx.membership.findUnique({ where: { userId_studioId: { userId, studioId: studio.id } } });
    const membership = existing
      ? await tx.membership.update({
          where: { id: existing.id },
          data: { roleTemplateId, status: 'ACTIVE', joinedAt: existing.joinedAt ?? now, isPartnerGuest: false },
        })
      : await tx.membership.create({ data: { userId, studioId: studio.id, roleTemplateId, status: 'ACTIVE', joinedAt: now } });

    await tx.platformMembership.update({
      where: { id: pm.id },
      data: { status: 'ACTIVE', activatedAt: now, deactivatedAt: null, platformStudioMembershipId: membership.id },
    });
    return { membershipId: membership.id, platformStudioId: studio.id };
  }

  /** Revocation: platform record and mirrored membership PASSIVE, refresh token dropped; takes effect on the next request. */
  async deactivateInTx(tx: Tx, userId: string): Promise<void> {
    const pm = await tx.platformMembership.findUnique({ where: { userId } });
    if (!pm) throw new NotFoundException(apiError('apiErrors.platformAccess.platformMembershipNotFound'));
    if (pm.status === 'PASSIVE') throw new ConflictException(apiError('apiErrors.platformAccess.platformMembershipAlreadyInactive'));
    await tx.platformMembership.update({ where: { id: pm.id }, data: { status: 'PASSIVE', deactivatedAt: new Date() } });
    if (pm.platformStudioMembershipId) {
      await tx.membership.updateMany({ where: { id: pm.platformStudioMembershipId }, data: { status: 'PASSIVE' } });
    }
    // Existing access tokens die on the guards' PlatformMembership check;
    // the refresh token is dropped so the session cannot be renewed.
    await tx.user.update({ where: { id: userId }, data: { refreshTokenHash: null } });
  }

  /** Moves the member to another platform role; an ACTIVE member's platform tenant membership follows in the same transaction. */
  async changeRoleInTx(tx: Tx, userId: string, platformRoleTemplateId: string): Promise<void> {
    const pm = await tx.platformMembership.findUnique({ where: { userId } });
    if (!pm) throw new NotFoundException(apiError('apiErrors.platformAccess.platformMembershipNotFound'));
    await tx.platformMembership.update({ where: { id: pm.id }, data: { roleTemplateId: platformRoleTemplateId } });
    if (pm.status === 'ACTIVE' && pm.platformStudioMembershipId) {
      const studio = await this.platformStudio(tx);
      const roleTemplateId = await this.syncSystemRoleTemplate(tx, studio.id, platformRoleTemplateId);
      await tx.membership.updateMany({ where: { id: pm.platformStudioMembershipId }, data: { roleTemplateId } });
    }
  }
}
