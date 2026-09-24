import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import {
  CreateMemberInput,
  AssignPackageToMemberInput,
} from '@platform/shared';

@Injectable()
export class MembersService {
  constructor(private prisma: PrismaService) {}

  async findAll(studioId: string, search?: string) {
    return this.prisma.memberProfile.findMany({
      where: {
        studioId,
        user: {
          isActive: true,
          ...(search
            ? {
                OR: [
                  { firstName: { contains: search, mode: 'insensitive' } },
                  { lastName: { contains: search, mode: 'insensitive' } },
                  { phone: { contains: search } },
                ],
              }
            : {}),
        },
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            avatarUrl: true,
            createdAt: true,
          },
        },
        packages: {
          where: { status: 'ACTIVE' },
          include: {
            packageDefinition: true,
          },
        },
        _count: {
          select: {
            bookings: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(memberId: string, studioId: string) {
    const member = await this.prisma.memberProfile.findFirst({
      where: { id: memberId, studioId },
      include: {
        user: true,
        packages: {
          include: {
            packageDefinition: true,
            freezeHistories: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        bookings: {
          include: {
            schedule: {
              include: {
                trainer: {
                  include: { user: true },
                },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        payments: {
          orderBy: { paidAt: 'desc' },
        },
      },
    });

    if (!member) {
      throw new NotFoundException('Üye bulunamadı');
    }

    return member;
  }

  async createMember(dto: CreateMemberInput) {
    // Check if phone exists in this studio
    const existing = await this.prisma.user.findFirst({
      where: {
        studioId: dto.studioId,
        phone: dto.phone,
      },
    });

    if (existing) {
      throw new BadRequestException('Bu telefon numarasıyla kayıtlı bir üye zaten mevcut');
    }

    // Default password is last 6 digits of phone or "123456"
    const rawPass = dto.phone.slice(-6) || '123456';
    const passwordHash = await bcrypt.hash(rawPass, 10);

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          studioId: dto.studioId,
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone,
          email: dto.email || null,
          passwordHash,
          role: 'MEMBER',
        },
      });

      const memberProfile = await tx.memberProfile.create({
        data: {
          userId: user.id,
          studioId: dto.studioId,
          birthDate: dto.birthDate ? new Date(dto.birthDate) : null,
          emergencyContactName: dto.emergencyContactName,
          emergencyContactPhone: dto.emergencyContactPhone,
          medicalConditions: dto.medicalConditions,
          notes: dto.notes,
          hasSignedWaiver: dto.hasSignedWaiver,
        },
        include: {
          user: true,
        },
      });

      return memberProfile;
    });
  }

  async assignPackage(dto: AssignPackageToMemberInput) {
    const pkgDef = await this.prisma.packageDefinition.findFirst({
      where: { id: dto.packageDefinitionId, studioId: dto.studioId },
    });

    if (!pkgDef) {
      throw new NotFoundException('Paket tanımı bulunamadı');
    }

    const startDate = dto.startDate ? new Date(dto.startDate) : new Date();
    const endDate = new Date(startDate.getTime() + pkgDef.validityDays * 24 * 60 * 60 * 1000);

    return this.prisma.$transaction(async (tx) => {
      const memberPackage = await tx.memberPackage.create({
        data: {
          studioId: dto.studioId,
          memberId: dto.memberId,
          packageDefinitionId: pkgDef.id,
          sessionType: pkgDef.sessionType,
          totalSessions: pkgDef.totalSessions,
          usedSessions: 0,
          remainingSessions: pkgDef.totalSessions,
          status: 'ACTIVE',
          startDate,
          endDate,
        },
      });

      await tx.payment.create({
        data: {
          studioId: dto.studioId,
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

  async freezePackage(packageId: string, studioId: string, days: number, reason: string) {
    const memberPackage = await this.prisma.memberPackage.findFirst({
      where: { id: packageId, studioId },
      include: { packageDefinition: true },
    });

    if (!memberPackage) {
      throw new NotFoundException('Paket bulunamadı');
    }

    if (days > memberPackage.packageDefinition.freezeDaysAllowed) {
      throw new BadRequestException(
        `Bu paket en fazla ${memberPackage.packageDefinition.freezeDaysAllowed} gün dondurulabilir.`,
      );
    }

    const now = new Date();
    const freezeUntil = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    const newEndDate = new Date(memberPackage.endDate.getTime() + days * 24 * 60 * 60 * 1000);

    return this.prisma.$transaction(async (tx) => {
      await tx.packageFreezeHistory.create({
        data: {
          memberPackageId: packageId,
          freezeStartDate: now,
          freezeEndDate: freezeUntil,
          reason,
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
}
