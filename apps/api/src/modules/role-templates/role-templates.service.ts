import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@platform/database';
import { ALL_PERMISSIONS, resolvePermissions } from '@platform/shared';
import type { AssignRoleTemplateInput, CreateRoleTemplateInput, RoleTemplateDTO, StaffMembershipDTO, UpdateRoleTemplateInput } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../auth/tenant-context';

/** A staff role -- the "member" template stays out of the role-management screen, it has no permissions to grant. */
const STAFF_ROLE_FILTER = { key: { not: 'member' } };

@Injectable()
export class RoleTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenant: TenantContext): Promise<RoleTemplateDTO[]> {
    const roles = await this.prisma.roleTemplate.findMany({
      where: { studioId: tenant.studioId },
      include: { permissions: true },
      orderBy: [{ isOwner: 'desc' }, { name: 'asc' }],
    });
    return roles.map(toRoleTemplateDTO);
  }

  async create(tenant: TenantContext, actorUserId: string, dto: CreateRoleTemplateInput): Promise<RoleTemplateDTO> {
    const key = slugifyRoleKey(dto.name);
    try {
      const role = await this.prisma.$transaction(async (tx) => {
        const created = await tx.roleTemplate.create({
          data: {
            studioId: tenant.studioId,
            key,
            name: dto.name,
            isOwner: false,
            isSystem: false,
            permissions: { create: dedupe(dto.permissions).map((permissionKey) => ({ permissionKey })) },
          },
          include: { permissions: true },
        });
        await tx.auditLog.create({
          data: {
            studioId: tenant.studioId,
            userId: actorUserId,
            action: 'role_template.create',
            entityType: 'RoleTemplate',
            entityId: created.id,
            metadata: { name: created.name, permissions: dto.permissions } as Prisma.InputJsonValue,
          },
        });
        return created;
      });
      return toRoleTemplateDTO(role);
    } catch (err) {
      throw this.mapUnique(err);
    }
  }

  async update(tenant: TenantContext, actorUserId: string, roleTemplateId: string, dto: UpdateRoleTemplateInput): Promise<RoleTemplateDTO> {
    const existing = await this.getOwned(tenant, roleTemplateId);
    if (existing.isOwner) {
      throw new BadRequestException('İşletme sahibi rolü değiştirilemez, her zaman tüm izinlere sahiptir');
    }

    const role = await this.prisma.$transaction(async (tx) => {
      if (dto.permissions) {
        await tx.roleTemplatePermission.deleteMany({ where: { roleTemplateId } });
      }
      const updated = await tx.roleTemplate.update({
        where: { id: roleTemplateId },
        data: {
          name: dto.name,
          permissions: dto.permissions ? { create: dedupe(dto.permissions).map((permissionKey) => ({ permissionKey })) } : undefined,
        },
        include: { permissions: true },
      });
      await tx.auditLog.create({
        data: {
          studioId: tenant.studioId,
          userId: actorUserId,
          action: 'role_template.update',
          entityType: 'RoleTemplate',
          entityId: roleTemplateId,
          metadata: { before: toRoleTemplateDTO(existing), after: dto } as unknown as Prisma.InputJsonValue,
        },
      });
      return updated;
    });
    return toRoleTemplateDTO(role);
  }

  async remove(tenant: TenantContext, actorUserId: string, roleTemplateId: string): Promise<{ deleted: true }> {
    const existing = await this.getOwned(tenant, roleTemplateId);
    // The owner role is permanent (CLAUDE.md rule 5); the "member" key is looked
    // up by key elsewhere (e.g. MembersService self-service signup) and must
    // always exist. Other seeded templates (reception, trainer, ...) are only
    // starting points and may be deleted once nobody is assigned to them.
    if (existing.isOwner || existing.key === 'member') {
      throw new BadRequestException('Bu rol silinemez');
    }
    const inUse = await this.prisma.membership.count({ where: { roleTemplateId } });
    if (inUse > 0) {
      throw new ConflictException('Bu role atanmış personel var; önce personeli başka bir role taşıyın');
    }
    await this.prisma.$transaction([
      this.prisma.roleTemplate.delete({ where: { id: roleTemplateId } }),
      this.prisma.auditLog.create({
        data: {
          studioId: tenant.studioId,
          userId: actorUserId,
          action: 'role_template.delete',
          entityType: 'RoleTemplate',
          entityId: roleTemplateId,
          metadata: { name: existing.name } as Prisma.InputJsonValue,
        },
      }),
    ]);
    return { deleted: true };
  }

  /** Staff (non-member) memberships, for the role-assignment screen. */
  async listStaff(tenant: TenantContext): Promise<StaffMembershipDTO[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { studioId: tenant.studioId, status: { not: 'PASSIVE' }, roleTemplate: STAFF_ROLE_FILTER },
      include: { user: { select: { id: true, firstName: true, lastName: true, phone: true } }, roleTemplate: true },
      orderBy: [{ roleTemplate: { isOwner: 'desc' } }, { user: { firstName: 'asc' } }],
    });
    return memberships.map((m) => ({
      membershipId: m.id,
      userId: m.user.id,
      fullName: `${m.user.firstName} ${m.user.lastName}`.trim(),
      phone: m.user.phone,
      status: m.status,
      roleTemplateId: m.roleTemplateId,
      roleName: m.roleTemplate.name,
      isOwner: m.roleTemplate.isOwner,
    }));
  }

  async assignRole(tenant: TenantContext, actorUserId: string, membershipId: string, dto: AssignRoleTemplateInput): Promise<StaffMembershipDTO> {
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, studioId: tenant.studioId },
      include: { roleTemplate: true, user: { select: { id: true, firstName: true, lastName: true, phone: true } } },
    });
    if (!membership) throw new NotFoundException('Personel bulunamadı');
    if (membership.roleTemplate.isOwner) {
      throw new BadRequestException('İşletme sahibinin rolü değiştirilemez');
    }
    const target = await this.prisma.roleTemplate.findFirst({ where: { id: dto.roleTemplateId, studioId: tenant.studioId } });
    if (!target) throw new BadRequestException('Rol bulunamadı');
    if (target.isOwner) {
      throw new BadRequestException('İşletme sahibi rolü atama yoluyla verilemez');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const m = await tx.membership.update({
        where: { id: membershipId },
        data: { roleTemplateId: target.id },
        include: { roleTemplate: true, user: { select: { id: true, firstName: true, lastName: true, phone: true } } },
      });
      await tx.auditLog.create({
        data: {
          studioId: tenant.studioId,
          userId: actorUserId,
          action: 'role_template.assign',
          entityType: 'Membership',
          entityId: membershipId,
          metadata: { fromRoleId: membership.roleTemplateId, toRoleId: target.id } as Prisma.InputJsonValue,
        },
      });
      return m;
    });
    return {
      membershipId: updated.id,
      userId: updated.user.id,
      fullName: `${updated.user.firstName} ${updated.user.lastName}`.trim(),
      phone: updated.user.phone,
      status: updated.status,
      roleTemplateId: updated.roleTemplateId,
      roleName: updated.roleTemplate.name,
      isOwner: updated.roleTemplate.isOwner,
    };
  }

  private async getOwned(tenant: TenantContext, roleTemplateId: string) {
    const role = await this.prisma.roleTemplate.findFirst({
      where: { id: roleTemplateId, studioId: tenant.studioId },
      include: { permissions: true },
    });
    if (!role) throw new NotFoundException('Rol bulunamadı');
    return role;
  }

  private mapUnique(err: unknown): unknown {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return new ConflictException('Bu isimde bir rol zaten var');
    }
    return err;
  }
}

function toRoleTemplateDTO(role: {
  id: string;
  studioId: string;
  key: string;
  name: string;
  isOwner: boolean;
  isSystem: boolean;
  permissions: { permissionKey: string }[];
}): RoleTemplateDTO {
  return {
    id: role.id,
    studioId: role.studioId,
    key: role.key,
    name: role.name,
    isOwner: role.isOwner,
    isSystem: role.isSystem,
    permissions: role.isOwner ? [...ALL_PERMISSIONS] : resolvePermissions({ isOwner: false, permissions: role.permissions.map((p) => p.permissionKey) }),
  };
}

function dedupe<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/** ASCII, lowercase, dash-separated key derived from the role name; a numeric suffix disambiguates collisions within a studio. */
function slugifyRoleKey(name: string): string {
  const base = name
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base || 'rol'}-${suffix}`;
}
