import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReferralStatus as PrismaReferralStatus } from '@platform/database';
import {
  ListReferralsQueryInput,
  ReferralCodeDTO,
  ReferralDTO,
  ReferralLandingDTO,
  ReferralRewardType,
  ReferralStatus,
  VoidReferralInput,
} from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../auth/tenant-context';
import { generateReferralCode } from './referral-code';

type ReferralRow = Prisma.ReferralGetPayload<{
  include: {
    referrerMember: { include: { membership: { include: { user: true } } } };
    referredUser: true;
  };
}>;

@Injectable()
export class ReferralsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------
  // Member self-service
  // ---------------------------------------------------------------------

  async myCode(tenant: TenantContext): Promise<ReferralCodeDTO> {
    if (!tenant.memberProfileId) throw new ForbiddenException('Bu işlemi yalnızca üyeler yapabilir');

    let row = await this.prisma.referralCode.findUnique({ where: { memberId: tenant.memberProfileId } });
    if (!row) {
      row = await this.createCodeWithRetry(tenant.studioId, tenant.memberProfileId);
    }

    const studio = await this.prisma.studio.findUnique({ where: { id: tenant.studioId }, select: { name: true } });
    return {
      code: row.code,
      shareText: `${studio?.name ?? 'Stüdyomuz'}a katıl ve avantajlardan yararlan! Kayıt olurken tavsiye kodumu kullan: ${row.code}`,
    };
  }

  async myReferrals(tenant: TenantContext): Promise<ReferralDTO[]> {
    if (!tenant.memberProfileId) throw new ForbiddenException('Bu işlemi yalnızca üyeler yapabilir');
    const rows = await this.prisma.referral.findMany({
      where: { studioId: tenant.studioId, referrerMemberId: tenant.memberProfileId },
      include: { referrerMember: { include: { membership: { include: { user: true } } } }, referredUser: true },
      orderBy: { createdAt: 'desc' },
    });
    await this.recompute(tenant.studioId, rows.map((r) => r.id));
    const refreshed = await this.prisma.referral.findMany({
      where: { studioId: tenant.studioId, referrerMemberId: tenant.memberProfileId },
      include: { referrerMember: { include: { membership: { include: { user: true } } } }, referredUser: true },
      orderBy: { createdAt: 'desc' },
    });
    return refreshed.map((r) => this.toDto(r));
  }

  // ---------------------------------------------------------------------
  // Recording a new referral (called from member creation / lead conversion)
  // ---------------------------------------------------------------------

  /**
   * Records a PENDING referral for a newly created member/user, given the
   * short code they signed up with. Silent no-op on an unknown code, self
   * referral, or a referredUserId already recorded for this studio (one row
   * per referred user per studio, since users are globally phone-unique).
   */
  async recordReferral(tx: Prisma.TransactionClient, studioId: string, referredUserId: string, referralCode: string): Promise<void> {
    const code = await tx.referralCode.findFirst({ where: { studioId, code: referralCode.toUpperCase() } });
    if (!code) return;

    const referrerMember = await tx.memberProfile.findUnique({ where: { id: code.memberId }, select: { membershipId: true } });
    if (!referrerMember) return;
    const referrerMembership = await tx.membership.findUnique({
      where: { id: referrerMember.membershipId },
      select: { userId: true },
    });
    if (!referrerMembership || referrerMembership.userId === referredUserId) return; // self-referral

    const referredUser = await tx.user.findUnique({ where: { id: referredUserId }, select: { phone: true } });
    if (!referredUser) return;

    try {
      await tx.referral.create({
        data: {
          studioId,
          referrerMemberId: code.memberId,
          referredUserId,
          referredPhone: referredUser.phone,
          referralCodeId: code.id,
          status: PrismaReferralStatus.PENDING,
        },
      });
    } catch (err) {
      // Already recorded for this studio+referred user (or same phone twice): ignore.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return;
      throw err;
    }
  }

  // ---------------------------------------------------------------------
  // Qualification and reward
  // ---------------------------------------------------------------------

  /**
   * Re-evaluates a batch of referrals: PENDING -> QUALIFIED when the
   * referred member has a first completed payment or first attended
   * booking, then QUALIFIED -> REWARDED, granting EXTRA_UNITS on the
   * referrer's active package exactly once (conditional status update).
   */
  async recompute(studioId: string, referralIds: string[]): Promise<void> {
    for (const id of referralIds) {
      await this.recomputeOne(studioId, id);
    }
  }

  private async recomputeOne(studioId: string, referralId: string): Promise<void> {
    const referral = await this.prisma.referral.findFirst({ where: { id: referralId, studioId } });
    if (!referral || referral.status === PrismaReferralStatus.REWARDED || referral.status === PrismaReferralStatus.VOIDED) return;

    if (referral.status === PrismaReferralStatus.PENDING) {
      const referredMember = await this.prisma.memberProfile.findFirst({
        where: { studioId, membership: { userId: referral.referredUserId } },
        select: { id: true },
      });
      if (!referredMember) return;

      const [payment, attended] = await Promise.all([
        this.prisma.payment.findFirst({ where: { studioId, memberId: referredMember.id, paymentStatus: 'COMPLETED' } }),
        this.prisma.booking.findFirst({ where: { studioId, memberId: referredMember.id, status: 'ATTENDED' } }),
      ]);
      if (!payment && !attended) return;

      // Whichever concurrent caller wins this conditional update marks the
      // qualification; a loser's count is 0 and simply means someone else
      // (possibly still in flight) is handling it. Every caller still goes
      // on to grantReward below, which is itself the single point of
      // truth for "exactly once" via its own conditional update, so no
      // request has to guess whether it was the winner.
      await this.prisma.referral.updateMany({
        where: { id: referral.id, studioId, status: PrismaReferralStatus.PENDING },
        data: { status: PrismaReferralStatus.QUALIFIED, qualifiedAt: new Date() },
      });
    }

    await this.grantReward(studioId, referral.id);
  }

  /** Conditional QUALIFIED -> REWARDED, crediting the referrer's active package exactly once. */
  private async grantReward(studioId: string, referralId: string): Promise<void> {
    const studio = await this.prisma.studio.findUnique({ where: { id: studioId }, select: { referralRewardUnits: true } });
    const rewardUnits = studio?.referralRewardUnits ?? 0;

    await this.prisma.$transaction(async (tx) => {
      const transitioned = await tx.referral.updateMany({
        where: { id: referralId, studioId, status: PrismaReferralStatus.QUALIFIED },
        data: {
          status: PrismaReferralStatus.REWARDED,
          rewardedAt: new Date(),
          rewardType: 'EXTRA_UNITS',
          rewardUnits,
        },
      });
      if (transitioned.count === 0) return; // already rewarded by a concurrent call

      if (rewardUnits <= 0) return;

      const referral = await tx.referral.findUniqueOrThrow({ where: { id: referralId } });
      const activePackage = await tx.memberPackage.findFirst({
        where: { studioId, memberId: referral.referrerMemberId, status: 'ACTIVE', entitlementKind: { in: ['SESSION_COUNT', 'CREDIT'] } },
        orderBy: { createdAt: 'desc' },
      });
      if (!activePackage) return;

      await tx.memberPackage.update({
        where: { id: activePackage.id },
        data: {
          totalUnits: activePackage.totalUnits != null ? activePackage.totalUnits + rewardUnits : undefined,
          remainingUnits: activePackage.remainingUnits != null ? activePackage.remainingUnits + rewardUnits : undefined,
        },
      });
      await tx.auditLog.create({
        data: {
          studioId,
          action: 'referral.reward.granted',
          entityType: 'Referral',
          entityId: referral.id,
          metadata: { rewardType: 'EXTRA_UNITS', rewardUnits, memberPackageId: activePackage.id },
        },
      });
    });
  }

  // ---------------------------------------------------------------------
  // Staff: list, manual reward, void
  // ---------------------------------------------------------------------

  async list(tenant: TenantContext, query: ListReferralsQueryInput): Promise<{ items: ReferralDTO[]; page: number; pageSize: number; total: number }> {
    const where: Prisma.ReferralWhereInput = {
      studioId: tenant.studioId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.memberId ? { referrerMemberId: query.memberId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.referral.findMany({
        where,
        include: { referrerMember: { include: { membership: { include: { user: true } } } }, referredUser: true },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.referral.count({ where }),
    ]);
    await this.recompute(tenant.studioId, rows.map((r) => r.id));
    const refreshed = await this.prisma.referral.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      include: { referrerMember: { include: { membership: { include: { user: true } } } }, referredUser: true },
      orderBy: { createdAt: 'desc' },
    });
    return { items: refreshed.map((r) => this.toDto(r)), page: query.page, pageSize: query.pageSize, total };
  }

  /** Staff-initiated reward, bypassing automatic qualification (e.g. a manual sale over the phone). */
  async manualReward(tenant: TenantContext, actorUserId: string, referralId: string): Promise<ReferralDTO> {
    const referral = await this.prisma.referral.findFirst({ where: { id: referralId, studioId: tenant.studioId } });
    if (!referral) throw new NotFoundException('Tavsiye kaydı bulunamadı');
    if (referral.status === PrismaReferralStatus.REWARDED) throw new ConflictException('Bu tavsiye zaten ödüllendirilmiş');
    if (referral.status === PrismaReferralStatus.VOIDED) throw new BadRequestException('İptal edilmiş bir tavsiye ödüllendirilemez');

    if (referral.status === PrismaReferralStatus.PENDING) {
      await this.prisma.referral.updateMany({
        where: { id: referral.id, studioId: tenant.studioId, status: PrismaReferralStatus.PENDING },
        data: { status: PrismaReferralStatus.QUALIFIED, qualifiedAt: new Date() },
      });
    }
    await this.grantReward(tenant.studioId, referral.id);
    await this.prisma.auditLog.create({
      data: { studioId: tenant.studioId, userId: actorUserId, action: 'referral.reward.manual', entityType: 'Referral', entityId: referral.id },
    });

    const row = await this.prisma.referral.findUniqueOrThrow({
      where: { id: referral.id },
      include: { referrerMember: { include: { membership: { include: { user: true } } } }, referredUser: true },
    });
    return this.toDto(row);
  }

  async voidReferral(tenant: TenantContext, actorUserId: string, referralId: string, dto: VoidReferralInput): Promise<ReferralDTO> {
    const referral = await this.prisma.referral.findFirst({ where: { id: referralId, studioId: tenant.studioId } });
    if (!referral) throw new NotFoundException('Tavsiye kaydı bulunamadı');
    if (referral.status === PrismaReferralStatus.REWARDED) {
      throw new BadRequestException('Ödül verilmiş bir tavsiye iptal edilemez');
    }
    const updated = await this.prisma.referral.update({
      where: { id: referral.id },
      data: { status: PrismaReferralStatus.VOIDED, voidedAt: new Date(), voidReason: dto.reason },
      include: { referrerMember: { include: { membership: { include: { user: true } } } }, referredUser: true },
    });
    await this.prisma.auditLog.create({
      data: {
        studioId: tenant.studioId,
        userId: actorUserId,
        action: 'referral.void',
        entityType: 'Referral',
        entityId: referral.id,
        metadata: { reason: dto.reason },
      },
    });
    return this.toDto(updated);
  }

  // ---------------------------------------------------------------------
  // Public landing
  // ---------------------------------------------------------------------

  async landing(code: string): Promise<ReferralLandingDTO | null> {
    const row = await this.prisma.referralCode.findFirst({
      where: { code: code.toUpperCase() },
      include: { studio: { select: { name: true, referralRewardUnits: true } } },
    });
    if (!row) return null;
    return {
      studioName: row.studio.name,
      offerText: `Arkadaşınızın tavsiye kodu ile kaydolun; ilk katılımınızdan sonra o da ${row.studio.referralRewardUnits} ekstra ders kazanır.`,
    };
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  private async createCodeWithRetry(studioId: string, memberId: string) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.prisma.referralCode.create({ data: { studioId, memberId, code: generateReferralCode() } });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
        throw err;
      }
    }
    throw new ConflictException('Tavsiye kodu oluşturulamadı, lütfen tekrar deneyin');
  }

  private toDto(row: ReferralRow): ReferralDTO {
    return {
      id: row.id,
      referrerMemberId: row.referrerMemberId,
      referrerName: `${row.referrerMember.membership.user.firstName} ${row.referrerMember.membership.user.lastName}`,
      referredUserId: row.referredUserId,
      referredName: `${row.referredUser.firstName} ${row.referredUser.lastName}`,
      referredPhone: row.referredPhone,
      status: row.status as unknown as ReferralStatus,
      qualifiedAt: row.qualifiedAt?.toISOString() ?? null,
      rewardedAt: row.rewardedAt?.toISOString() ?? null,
      rewardType: (row.rewardType as unknown as ReferralRewardType) ?? null,
      rewardUnits: row.rewardUnits,
      voidedAt: row.voidedAt?.toISOString() ?? null,
      voidReason: row.voidReason,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
