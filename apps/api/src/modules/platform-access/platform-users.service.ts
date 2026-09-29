import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InviteChannel, Prisma } from '@platform/database';
import {
  ALL_PLATFORM_PERMISSIONS,
  resolvePlatformPermissions,
  resolvePlatformTenantPermissions,
  type PlatformAccessSettingsDTO,
  type PlatformContextDTO,
  type PlatformInviteInput,
  type PlatformMemberDTO,
  type PlatformRoleTemplateDTO,
} from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { InvitesService } from '../invites/invites.service';
import type { PlatformContext } from '../auth/tenant-context';
import { PlatformAccessService } from './platform-access.service';

function maskPhone(phone: string): string {
  return phone.length > 6 ? `${phone.slice(0, 6)}*****${phone.slice(-2)}` : '*****';
}

type AuditAction =
  | 'platform_user.invited'
  | 'platform_user.role_changed'
  | 'platform_user.deactivated'
  | 'platform_user.reactivated'
  | 'platform_user.mfa_reset'
  | 'platform_access.settings_updated';

/**
 * Super admin screen "Platform kullanıcıları" (docs/PAZARLAMA_MODULU.md
 * 2.6): invite by phone, change role, deactivate/reactivate, reset 2FA and
 * the 2FA policy. Every action is one transaction with its AuditLog row
 * (studioId null, entityType platform_membership, actor in userId, target
 * in entityId/metadata).
 */
@Injectable()
export class PlatformUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PlatformAccessService,
    private readonly invites: InvitesService,
  ) {}

  async roleTemplates(): Promise<PlatformRoleTemplateDTO[]> {
    await this.access.ensureDefaults();
    const rows = await this.prisma.platformRoleTemplate.findMany({ include: { permissions: true }, orderBy: { name: 'asc' } });
    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      isSystem: r.isSystem,
      permissions: resolvePlatformPermissions(r.permissions.map((p) => p.permissionKey)),
    }));
  }

  async list(): Promise<PlatformMemberDTO[]> {
    const rows = await this.prisma.platformMembership.findMany({
      include: {
        user: { select: { id: true, firstName: true, lastName: true, phone: true, mfaEnabledAt: true } },
        roleTemplate: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const pendingInvites = await this.prisma.inviteToken.findMany({
      where: { platformRoleTemplateId: { not: null }, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { phone: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      fullName: `${r.user.firstName} ${r.user.lastName}`.trim(),
      phoneMasked: maskPhone(r.user.phone),
      status: r.status,
      roleTemplateId: r.roleTemplate.id,
      roleName: r.roleTemplate.name,
      mfaEnabled: r.user.mfaEnabledAt !== null,
      invitedAt: r.createdAt.toISOString(),
      activatedAt: r.activatedAt?.toISOString() ?? null,
      deactivatedAt: r.deactivatedAt?.toISOString() ?? null,
      inviteExpiresAt:
        r.status === 'INVITED' ? (pendingInvites.find((i) => i.phone === r.user.phone)?.expiresAt.toISOString() ?? null) : null,
    }));
  }

  /**
   * Invite by phone (CLAUDE.md rule 6: users are global and phone based).
   * A user row is created when the phone is new, the PlatformMembership is
   * INVITED, and the regular InviteToken flow (OTP -> PIN -> consent)
   * activates it on acceptance.
   */
  async invite(actorUserId: string, dto: PlatformInviteInput) {
    await this.access.ensureDefaults();
    const template = await this.prisma.platformRoleTemplate.findUnique({ where: { id: dto.roleTemplateId } });
    if (!template) throw new BadRequestException('Platform rolü bulunamadı');
    const studio = await this.access.platformStudio();
    const systemRoleTemplateId = await this.access.systemRoleTemplateId(template.id);

    const [firstName, ...rest] = dto.fullName.trim().split(/\s+/);
    const lastName = rest.join(' ') || '-';

    const userId = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { phone: dto.phone },
        create: { phone: dto.phone, firstName, lastName },
        update: {},
      });
      if (user.isSuperAdmin) throw new ConflictException('Bu kişi zaten süper admin');
      const pm = await tx.platformMembership.findUnique({ where: { userId: user.id } });
      if (pm?.status === 'ACTIVE') throw new ConflictException('Bu kişinin platform üyeliği zaten aktif');
      if (pm) {
        await tx.platformMembership.update({
          where: { id: pm.id },
          data: { status: 'INVITED', roleTemplateId: template.id, invitedByUserId: actorUserId },
        });
      } else {
        await tx.platformMembership.create({
          data: { userId: user.id, roleTemplateId: template.id, status: 'INVITED', invitedByUserId: actorUserId },
        });
      }
      await this.audit(tx, actorUserId, 'platform_user.invited', user.id, { roleTemplateId: template.id, roleKey: template.key, channel: dto.channel });
      return user.id;
    });

    const invite = await this.invites.createPlatformInvite({
      platformStudioId: studio.id,
      creatorUserId: actorUserId,
      systemRoleTemplateId,
      platformRoleTemplateId: template.id,
      phone: dto.phone,
      fullName: dto.fullName,
      channel: dto.channel as InviteChannel,
    });
    return { userId, ...invite };
  }

  async changeRole(actorUserId: string, userId: string, roleTemplateId: string): Promise<PlatformMemberDTO> {
    const pm = await this.getMember(userId);
    const template = await this.prisma.platformRoleTemplate.findUnique({ where: { id: roleTemplateId } });
    if (!template) throw new BadRequestException('Platform rolü bulunamadı');
    await this.prisma.$transaction(async (tx) => {
      await this.access.changeRoleInTx(tx, userId, template.id);
      await this.audit(tx, actorUserId, 'platform_user.role_changed', userId, { fromRoleTemplateId: pm.roleTemplateId, toRoleTemplateId: template.id });
    });
    return this.one(userId);
  }

  async deactivate(actorUserId: string, userId: string): Promise<PlatformMemberDTO> {
    const pm = await this.getMember(userId);
    await this.prisma.$transaction(async (tx) => {
      await this.access.deactivateInTx(tx, userId);
      // A pending invite must not re-activate a revoked account.
      await tx.inviteToken.updateMany({
        where: { platformRoleTemplateId: { not: null }, usedAt: null, revokedAt: null, phone: pm.user.phone },
        data: { revokedAt: new Date() },
      });
      await this.audit(tx, actorUserId, 'platform_user.deactivated', userId, { previousStatus: pm.status });
    });
    return this.one(userId);
  }

  async reactivate(actorUserId: string, userId: string): Promise<PlatformMemberDTO> {
    const pm = await this.getMember(userId);
    if (pm.status !== 'PASSIVE') throw new ConflictException('Yalnızca pasif bir platform üyeliği yeniden etkinleştirilebilir');
    await this.prisma.$transaction(async (tx) => {
      await this.access.activateInTx(tx, userId);
      await this.audit(tx, actorUserId, 'platform_user.reactivated', userId, { roleTemplateId: pm.roleTemplateId });
    });
    return this.one(userId);
  }

  /** Lost authenticator: clears the secret and recovery codes and drops the session; the user enrols again at next sign-in. */
  async resetMfa(actorUserId: string, userId: string): Promise<PlatformMemberDTO> {
    await this.getMember(userId);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { totpSecretEncrypted: null, mfaEnabledAt: null, totpLastUsedStep: null, refreshTokenHash: null },
      });
      await tx.userMfaRecoveryCode.deleteMany({ where: { userId } });
      await this.audit(tx, actorUserId, 'platform_user.mfa_reset', userId, {});
    });
    return this.one(userId);
  }

  async settings(): Promise<PlatformAccessSettingsDTO> {
    await this.access.ensureDefaults();
    const row = await this.prisma.platformAccessSettings.findUniqueOrThrow({ where: { id: 'platform' } });
    return { require2faForPlatformRoles: row.require2faForPlatformRoles };
  }

  async updateSettings(actorUserId: string, dto: PlatformAccessSettingsDTO): Promise<PlatformAccessSettingsDTO> {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.platformAccessSettings.findUnique({ where: { id: 'platform' } });
      await tx.platformAccessSettings.upsert({
        where: { id: 'platform' },
        create: { id: 'platform', require2faForPlatformRoles: dto.require2faForPlatformRoles, updatedByUserId: actorUserId },
        update: { require2faForPlatformRoles: dto.require2faForPlatformRoles, updatedByUserId: actorUserId },
      });
      await tx.auditLog.create({
        data: {
          studioId: null,
          userId: actorUserId,
          action: 'platform_access.settings_updated',
          entityType: 'platform_access_settings',
          entityId: 'platform',
          metadata: { before: before?.require2faForPlatformRoles ?? true, after: dto.require2faForPlatformRoles } as Prisma.InputJsonValue,
        },
      });
    });
    return this.settings();
  }

  /** Shell context for /pazarlama (and the super admin's view of it). */
  async context(platform: PlatformContext): Promise<PlatformContextDTO> {
    const studio = await this.access.platformStudio();
    const permissions = platform.isSuperAdmin ? [...ALL_PLATFORM_PERMISSIONS] : [...platform.permissions];
    return {
      platformStudioId: studio.id,
      studioName: studio.name,
      currency: studio.currency,
      defaultLocale: studio.defaultLocale,
      isSuperAdmin: platform.isSuperAdmin,
      permissions,
      tenantPermissions: resolvePlatformTenantPermissions(permissions),
    };
  }

  private async getMember(userId: string) {
    const pm = await this.prisma.platformMembership.findUnique({ where: { userId }, include: { user: { select: { phone: true } } } });
    if (!pm) throw new NotFoundException('Platform kullanıcısı bulunamadı');
    return pm;
  }

  private async one(userId: string): Promise<PlatformMemberDTO> {
    const all = await this.list();
    const found = all.find((m) => m.userId === userId);
    if (!found) throw new NotFoundException('Platform kullanıcısı bulunamadı');
    return found;
  }

  private async audit(tx: Prisma.TransactionClient, actorUserId: string, action: AuditAction, targetUserId: string, metadata: Record<string, unknown>) {
    await tx.auditLog.create({
      data: {
        studioId: null,
        userId: actorUserId,
        action,
        entityType: 'platform_membership',
        entityId: targetUserId,
        metadata: { ...metadata, actorUserId, targetUserId, via: 'admin' } as Prisma.InputJsonValue,
      },
    });
  }
}
