import { Injectable, NotFoundException, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../auth/tenant-context';
import { CreateMemberInput, AssignPackageToMemberInput, FreezePackageInput } from '@platform/shared';
import type { SetHomeBranchInput } from '@platform/shared';
import { assertBranchAccess } from '../branches/branch-access';
import { ReferralsService } from '../feedback/referrals.service';

@Injectable()
export class MembersService {
  constructor(
    private prisma: PrismaService,
    private referrals: ReferralsService,
  ) {}

  async findAll(tenant: TenantContext, search?: string, homeBranchId?: string) {
    if (homeBranchId) assertBranchAccess(tenant, homeBranchId);
    const members = await this.prisma.memberProfile.findMany({
      where: {
        studioId: tenant.studioId,
        ...(homeBranchId ? { homeBranchId } : {}),
        ...(search
          ? {
              membership: {
                user: {
                  OR: [
                    { firstName: { contains: search, mode: 'insensitive' } },
                    { lastName: { contains: search, mode: 'insensitive' } },
                    { phone: { contains: search } },
                  ],
                },
              },
            }
          : {}),
      },
      include: {
        membership: { include: { user: true } },
        packages: {
          where: { status: 'ACTIVE' },
          include: { packageDefinition: true },
        },
        _count: { select: { bookings: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return members.map((m) => this.toDetail(m, tenant));
  }

  /** Staff set a member's home branch; members may set their own. Null clears it. */
  async setHomeBranch(tenant: TenantContext, memberId: string, dto: SetHomeBranchInput) {
    const member = await this.prisma.memberProfile.findFirst({ where: { id: memberId, studioId: tenant.studioId } });
    if (!member) throw new NotFoundException('Üye bulunamadı');
    if (dto.branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: dto.branchId, studioId: tenant.studioId, isActive: true },
      });
      if (!branch) throw new BadRequestException('Seçilen şube bu işletmede bulunamadı veya pasif');
    }
    const updated = await this.prisma.memberProfile.update({
      where: { id: member.id },
      data: { homeBranchId: dto.branchId },
      select: { id: true, homeBranchId: true },
    });
    return { memberId: updated.id, homeBranchId: updated.homeBranchId };
  }

  /**
   * The caller's own active, unexpired packages, optionally narrowed to
   * those covering one service type. Used by the mobile booking flow to
   * offer a package when reserving a spot.
   */
  async getSelfPackages(tenant: TenantContext, serviceTypeId?: string) {
    if (!tenant.memberProfileId) {
      throw new ForbiddenException('Bu işletmede üye profiliniz yok');
    }
    const packages = await this.prisma.memberPackage.findMany({
      where: {
        studioId: tenant.studioId,
        memberId: tenant.memberProfileId,
        status: 'ACTIVE',
        endDate: { gte: new Date() },
        ...(serviceTypeId ? { packageDefinition: { services: { some: { serviceTypeId } } } } : {}),
      },
      include: { packageDefinition: true },
      orderBy: { endDate: 'asc' },
    });
    return packages.map((p) => ({
      id: p.id,
      memberId: p.memberId,
      packageDefinitionId: p.packageDefinitionId,
      packageDefinitionName: p.packageDefinition.name,
      entitlementKind: p.entitlementKind,
      totalUnits: p.totalUnits,
      usedUnits: p.usedUnits,
      remainingUnits: p.remainingUnits,
      status: p.status,
      startDate: p.startDate,
      endDate: p.endDate,
      frozenUntil: p.frozenUntil,
    }));
  }

  async findById(memberId: string, tenant: TenantContext) {
    const member = await this.prisma.memberProfile.findFirst({
      where: { id: memberId, studioId: tenant.studioId },
      include: {
        membership: { include: { user: true } },
        packages: {
          include: { packageDefinition: true, freezeHistories: true },
          orderBy: { createdAt: 'desc' },
        },
        bookings: {
          include: {
            schedule: {
              include: {
                trainer: { include: { membership: { include: { user: true } } } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        payments: { orderBy: { paidAt: 'desc' } },
      },
    });

    if (!member) {
      throw new NotFoundException('Üye bulunamadı');
    }

    return this.toDetail(member, tenant);
  }

  async createMember(tenant: TenantContext, dto: CreateMemberInput) {
    const studioId = tenant.studioId;

    const roleTemplate = await this.prisma.roleTemplate.findFirst({
      where: { studioId, key: 'member' },
    });
    if (!roleTemplate) {
      throw new NotFoundException('Üye rol şablonu bulunamadı');
    }

    return this.prisma.$transaction(async (tx) => {
      let user = await tx.user.findUnique({ where: { phone: dto.phone } });
      if (!user) {
        user = await tx.user.create({
          data: {
            phone: dto.phone,
            email: dto.email || null,
            firstName: dto.firstName,
            lastName: dto.lastName,
            passwordHash: null,
          },
        });
      }

      const existingMembership = await tx.membership.findUnique({
        where: { userId_studioId: { userId: user.id, studioId } },
      });
      if (existingMembership) {
        throw new ConflictException('Bu telefon numarasına sahip bir üyelik bu işletmede zaten mevcut');
      }

      const membership = await tx.membership.create({
        data: {
          userId: user.id,
          studioId,
          roleTemplateId: roleTemplate.id,
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
      });

      const memberProfile = await tx.memberProfile.create({
        data: {
          membershipId: membership.id,
          studioId,
          birthDate: dto.birthDate ? new Date(dto.birthDate) : null,
          emergencyContactName: dto.emergencyContactName || null,
          emergencyContactPhone: dto.emergencyContactPhone || null,
          medicalConditions: dto.medicalConditions || null,
          notes: dto.notes || null,
        },
        include: { membership: { include: { user: true } } },
      });

      if (dto.referralCode) {
        await this.referrals.recordReferral(tx, studioId, user.id, dto.referralCode);
      }

      return this.toDetail(memberProfile, tenant);
    });
  }

  async assignPackage(tenant: TenantContext, dto: AssignPackageToMemberInput) {
    const studioId = tenant.studioId;

    const [pkgDef, member] = await Promise.all([
      this.prisma.packageDefinition.findFirst({ where: { id: dto.packageDefinitionId, studioId } }),
      this.prisma.memberProfile.findFirst({ where: { id: dto.memberId, studioId } }),
    ]);
    if (!pkgDef) {
      throw new NotFoundException('Paket tanımı bulunamadı');
    }
    if (!member) {
      throw new NotFoundException('Üye bulunamadı');
    }

    const startDate = dto.startDate ? new Date(dto.startDate) : new Date();
    const endDate = new Date(startDate.getTime() + pkgDef.validityDays * 24 * 60 * 60 * 1000);

    return this.prisma.$transaction(async (tx) => {
      const memberPackage = await tx.memberPackage.create({
        data: {
          studioId,
          memberId: dto.memberId,
          packageDefinitionId: pkgDef.id,
          entitlementKind: pkgDef.entitlementKind,
          totalUnits: pkgDef.totalUnits,
          usedUnits: 0,
          remainingUnits: pkgDef.totalUnits,
          status: 'ACTIVE',
          startDate,
          endDate,
        },
      });

      await tx.payment.create({
        data: {
          studioId,
          memberId: dto.memberId,
          memberPackageId: memberPackage.id,
          amount: dto.paidAmount,
          paymentMethod: dto.paymentMethod,
          paymentStatus: 'COMPLETED',
          notes: dto.notes,
        },
      });

      return memberPackage;
    });
  }

  async freezePackage(packageId: string, tenant: TenantContext, dto: FreezePackageInput) {
    const studioId = tenant.studioId;

    const memberPackage = await this.prisma.memberPackage.findFirst({
      where: { id: packageId, studioId },
      include: { packageDefinition: true },
    });
    if (!memberPackage) {
      throw new NotFoundException('Paket bulunamadı');
    }

    if (dto.days > memberPackage.packageDefinition.freezeDaysAllowed) {
      throw new BadRequestException(
        `Bu paket en fazla ${memberPackage.packageDefinition.freezeDaysAllowed} gün dondurulabilir.`,
      );
    }

    const now = new Date();
    const freezeUntil = new Date(now.getTime() + dto.days * 24 * 60 * 60 * 1000);
    const newEndDate = new Date(memberPackage.endDate.getTime() + dto.days * 24 * 60 * 60 * 1000);

    return this.prisma.$transaction(async (tx) => {
      await tx.packageFreezeHistory.create({
        data: {
          memberPackageId: packageId,
          freezeStartDate: now,
          freezeEndDate: freezeUntil,
          reason: dto.reason,
        },
      });

      return tx.memberPackage.update({
        where: { id: packageId },
        data: {
          status: 'FROZEN',
          frozenUntil: freezeUntil,
          endDate: newEndDate,
        },
      });
    });
  }

  /** Shapes a member profile row into a response, masking contact/health fields by permission. */
  private toDetail(member: any, tenant: TenantContext) {
    const user = member.membership?.user;
    const dto: Record<string, unknown> = {
      id: member.id,
      membershipId: member.membershipId,
      studioId: member.studioId,
      firstName: user?.firstName,
      lastName: user?.lastName,
      birthDate: member.birthDate,
      familyGroupId: member.familyGroupId ?? null,
      notes: member.notes ?? null,
      packages: member.packages,
      bookings: member.bookings,
      payments: member.payments,
      bookingsCount: member._count?.bookings,
    };

    // Any phone number, including the emergency contact's, is contact data.
    if (tenant.permissions.has('members.contact.view')) {
      dto.phone = user?.phone;
      dto.email = user?.email;
      dto.emergencyContactPhone = member.emergencyContactPhone ?? null;
    }
    if (tenant.permissions.has('members.health.view')) {
      dto.medicalConditions = member.medicalConditions ?? null;
      dto.emergencyContactName = member.emergencyContactName ?? null;
    }

    return dto;
  }
}
