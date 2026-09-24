import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../auth/tenant-context';
import { EntitlementKind, Prisma, VideoContentVisibility } from '@platform/database';
import type {
  CreateVideoContentInput,
  ListVideoContentQueryInput,
  MemberVideoContentDTO,
  RecordVideoProgressInput,
  UpdateVideoContentInput,
  VideoContentDTO,
  VideoContentStatsDTO,
} from '@platform/shared';

const INSUFFICIENT_CREDIT = 'Pakette yeterli kredi kalmamıştır';

@Injectable()
export class ContentService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Staff CRUD
  // ---------------------------------------------------------------------------

  async create(tenant: TenantContext, dto: CreateVideoContentInput): Promise<VideoContentDTO> {
    const studioId = tenant.studioId;
    await this.assertServiceTypeAndTrainer(studioId, dto.serviceTypeId, dto.trainerProfileId);
    await this.assertPackages(studioId, dto.packageDefinitionIds);

    const content = await this.prisma.videoContent.create({
      data: {
        studioId,
        title: dto.title,
        description: dto.description || null,
        durationSeconds: dto.durationSeconds,
        provider: dto.provider,
        sourceUrl: dto.sourceUrl ?? null,
        thumbnailUrl: dto.thumbnailUrl ?? null,
        serviceTypeId: dto.serviceTypeId ?? null,
        trainerProfileId: dto.trainerProfileId ?? null,
        visibility: dto.visibility,
        creditCost: dto.creditCost ?? null,
        packages: { create: dto.packageDefinitionIds.map((packageDefinitionId) => ({ packageDefinitionId })) },
      },
      include: { serviceType: true, trainerProfile: { include: { membership: { include: { user: true } } } }, packages: true },
    });
    return this.toDTO(content);
  }

  async update(tenant: TenantContext, contentId: string, dto: UpdateVideoContentInput): Promise<VideoContentDTO> {
    const studioId = tenant.studioId;
    const existing = await this.prisma.videoContent.findFirst({ where: { id: contentId, studioId } });
    if (!existing) {
      throw new NotFoundException('Video içeriği bulunamadı');
    }
    await this.assertServiceTypeAndTrainer(studioId, dto.serviceTypeId, dto.trainerProfileId);
    await this.assertPackages(studioId, dto.packageDefinitionIds);

    const content = await this.prisma.$transaction(async (tx) => {
      await tx.videoContentPackage.deleteMany({ where: { videoContentId: contentId } });
      return tx.videoContent.update({
        where: { id: contentId },
        data: {
          title: dto.title,
          description: dto.description || null,
          durationSeconds: dto.durationSeconds,
          provider: dto.provider,
          sourceUrl: dto.sourceUrl ?? null,
          thumbnailUrl: dto.thumbnailUrl ?? null,
          serviceTypeId: dto.serviceTypeId ?? null,
          trainerProfileId: dto.trainerProfileId ?? null,
          visibility: dto.visibility,
          creditCost: dto.creditCost ?? null,
          packages: { create: dto.packageDefinitionIds.map((packageDefinitionId) => ({ packageDefinitionId })) },
        },
        include: { serviceType: true, trainerProfile: { include: { membership: { include: { user: true } } } }, packages: true },
      });
    });
    return this.toDTO(content);
  }

  async setPublished(tenant: TenantContext, contentId: string, isPublished: boolean): Promise<VideoContentDTO> {
    const studioId = tenant.studioId;
    const existing = await this.prisma.videoContent.findFirst({ where: { id: contentId, studioId } });
    if (!existing) {
      throw new NotFoundException('Video içeriği bulunamadı');
    }
    const content = await this.prisma.videoContent.update({
      where: { id: contentId },
      data: { isPublished, publishedAt: isPublished ? new Date() : existing.publishedAt },
      include: { serviceType: true, trainerProfile: { include: { membership: { include: { user: true } } } }, packages: true },
    });
    return this.toDTO(content);
  }

  async listForStaff(tenant: TenantContext, query: ListVideoContentQueryInput): Promise<VideoContentDTO[]> {
    const contents = await this.prisma.videoContent.findMany({
      where: {
        studioId: tenant.studioId,
        ...(query.serviceTypeId ? { serviceTypeId: query.serviceTypeId } : {}),
        ...(query.publishedOnly ? { isPublished: true } : {}),
      },
      include: { serviceType: true, trainerProfile: { include: { membership: { include: { user: true } } } }, packages: true },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return contents.map((c) => this.toDTO(c));
  }

  // ---------------------------------------------------------------------------
  // Member self-service
  // ---------------------------------------------------------------------------

  async listForMember(tenant: TenantContext, query: ListVideoContentQueryInput): Promise<MemberVideoContentDTO[]> {
    if (!tenant.memberProfileId) {
      throw new ForbiddenException('Yalnızca üyeler görüntüleyebilir');
    }
    const memberId = tenant.memberProfileId;
    const studioId = tenant.studioId;

    const [contents, activePackageDefIds, views] = await Promise.all([
      this.prisma.videoContent.findMany({
        where: {
          studioId,
          isPublished: true,
          ...(query.serviceTypeId ? { serviceTypeId: query.serviceTypeId } : {}),
        },
        include: { serviceType: true, trainerProfile: { include: { membership: { include: { user: true } } } }, packages: true },
        orderBy: { publishedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.activePackageDefinitionIds(studioId, memberId),
      this.prisma.videoView.findMany({ where: { studioId, memberId } }),
    ]);

    const viewByContent = new Map(views.map((v) => [v.videoContentId, v]));
    return contents.map((content) => {
      const dto = this.toDTO(content);
      const view = viewByContent.get(content.id);
      const { locked, reason } = this.evaluateLock(content, activePackageDefIds);
      return {
        ...dto,
        // A locked card explains why but never reveals the playable source.
        sourceUrl: locked ? null : dto.sourceUrl,
        isLocked: locked,
        lockedReason: reason,
        lastPositionSeconds: view?.lastPositionSeconds ?? null,
        completedAt: view?.completedAt?.toISOString() ?? null,
        isCreditCharged: !!view?.creditChargedAt,
      } satisfies MemberVideoContentDTO;
    });
  }

  /**
   * Starts (or resumes) watching: creates the VideoView row once per
   * member+content and, on the first successful call only, charges
   * creditCost from the given CREDIT package atomically - a conditional
   * update on VideoView.creditChargedAt claims the charge before the
   * package is touched, so two parallel requests can charge at most once
   * (the loser's transaction sees the claim already taken and no-ops).
   */
  async start(tenant: TenantContext, contentId: string, memberPackageId?: string) {
    if (!tenant.memberProfileId) {
      throw new ForbiddenException('Yalnızca üyeler izleyebilir');
    }
    const studioId = tenant.studioId;
    const memberId = tenant.memberProfileId;

    const content = await this.prisma.videoContent.findFirst({
      where: { id: contentId, studioId, isPublished: true },
      include: { serviceType: true, trainerProfile: { include: { membership: { include: { user: true } } } }, packages: true },
    });
    if (!content) {
      throw new NotFoundException('Video içeriği bulunamadı');
    }

    const activePackageDefIds = await this.activePackageDefinitionIds(studioId, memberId);
    const { locked, reason } = this.evaluateLock(content, activePackageDefIds);
    if (locked) {
      throw new ForbiddenException(reason ?? 'Bu içeriğe erişiminiz yok');
    }

    // Two concurrent first-time watchers can both race this insert; this
    // runs as its own statement (not inside the charge transaction below) so
    // a unique-constraint error here never aborts a later transaction - the
    // loser simply re-reads the row the winner just created.
    let view;
    try {
      view = await this.prisma.videoView.create({ data: { studioId, videoContentId: contentId, memberId } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        view = await this.prisma.videoView.findUniqueOrThrow({
          where: { videoContentId_memberId: { videoContentId: contentId, memberId } },
        });
      } else {
        throw err;
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      if (!content.creditCost || content.creditCost <= 0 || view.creditChargedAt) {
        return { view, charged: false };
      }

      // Whoever wins this conditional update owns the charge; the loser
      // (count 0) has nothing left to do - the view already exists.
      const claimed = await tx.videoView.updateMany({
        where: { id: view.id, creditChargedAt: null },
        data: { creditChargedAt: new Date() },
      });
      if (claimed.count === 0) {
        return { view, charged: false };
      }

      if (!memberPackageId) {
        throw new BadRequestException('Bu içerik için bir kredi paketi seçmelisiniz');
      }
      const memberPackage = await tx.memberPackage.findFirst({ where: { id: memberPackageId, studioId } });
      if (!memberPackage || memberPackage.memberId !== memberId) {
        throw new BadRequestException('Seçilen paket bu üyeye ait değil');
      }
      if (memberPackage.entitlementKind !== EntitlementKind.CREDIT) {
        throw new BadRequestException('Yalnızca kredi bazlı paketler bu içerik için kullanılabilir');
      }
      const charged = await tx.memberPackage.updateMany({
        where: { id: memberPackage.id, studioId, status: 'ACTIVE', remainingUnits: { gte: content.creditCost } },
        data: { usedUnits: { increment: content.creditCost }, remainingUnits: { decrement: content.creditCost } },
      });
      if (charged.count === 0) {
        throw new ConflictException(INSUFFICIENT_CREDIT);
      }

      return { view: await tx.videoView.findUniqueOrThrow({ where: { id: view.id } }), charged: true };
    });

    return { content: this.toDTO(content), view: result.view, charged: result.charged };
  }

  async recordProgress(tenant: TenantContext, contentId: string, dto: RecordVideoProgressInput) {
    if (!tenant.memberProfileId) {
      throw new ForbiddenException('Yalnızca üyeler görüntüleyebilir');
    }
    const memberId = tenant.memberProfileId;
    const studioId = tenant.studioId;

    const view = await this.prisma.videoView.findFirst({ where: { studioId, videoContentId: contentId, memberId } });
    if (!view) {
      throw new NotFoundException('Önce izlemeye başlamalısınız');
    }
    return this.prisma.videoView.update({
      where: { id: view.id },
      data: {
        lastPositionSeconds: dto.positionSeconds,
        completedAt: dto.completed ? new Date() : view.completedAt,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Reports
  // ---------------------------------------------------------------------------

  async stats(tenant: TenantContext): Promise<VideoContentStatsDTO[]> {
    const contents = await this.prisma.videoContent.findMany({
      where: { studioId: tenant.studioId },
      include: { views: true },
      orderBy: { createdAt: 'desc' },
    });
    return contents.map((content) => ({
      contentId: content.id,
      title: content.title,
      views: content.views.length,
      completions: content.views.filter((v) => v.completedAt !== null).length,
      uniqueViewers: new Set(content.views.map((v) => v.memberId)).size,
    }));
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async assertServiceTypeAndTrainer(studioId: string, serviceTypeId?: string, trainerProfileId?: string) {
    if (serviceTypeId) {
      const serviceType = await this.prisma.serviceType.findFirst({ where: { id: serviceTypeId, studioId } });
      if (!serviceType) {
        throw new BadRequestException('Seçilen hizmet türü bu işletmede bulunamadı');
      }
    }
    if (trainerProfileId) {
      const trainer = await this.prisma.trainerProfile.findFirst({ where: { id: trainerProfileId, studioId } });
      if (!trainer) {
        throw new BadRequestException('Seçilen eğitmen bu işletmede bulunamadı');
      }
    }
  }

  private async assertPackages(studioId: string, packageDefinitionIds: string[]) {
    if (packageDefinitionIds.length === 0) return;
    const count = await this.prisma.packageDefinition.count({ where: { id: { in: packageDefinitionIds }, studioId } });
    if (count !== packageDefinitionIds.length) {
      throw new BadRequestException('Seçilen paketlerden biri bu işletmede bulunamadı');
    }
  }

  /** Package-definition ids covered by the member's currently ACTIVE, unexpired packages. */
  private async activePackageDefinitionIds(studioId: string, memberId: string): Promise<Set<string>> {
    const packages = await this.prisma.memberPackage.findMany({
      where: { studioId, memberId, status: 'ACTIVE', endDate: { gte: new Date() } },
      select: { packageDefinitionId: true },
    });
    return new Set(packages.map((p) => p.packageDefinitionId));
  }

  private evaluateLock(
    content: { visibility: VideoContentVisibility; packages?: { packageDefinitionId: string }[] },
    activePackageDefIds: Set<string>,
  ): { locked: boolean; reason: string | null } {
    if (content.visibility === VideoContentVisibility.ALL_MEMBERS) {
      return { locked: false, reason: null };
    }
    if (content.visibility === VideoContentVisibility.MEMBERS_WITH_ACTIVE_PACKAGE) {
      if (activePackageDefIds.size > 0) return { locked: false, reason: null };
      return { locked: true, reason: 'Bu içeriği izlemek için aktif bir paketiniz olmalıdır' };
    }
    // SPECIFIC_PACKAGES
    const required = content.packages ?? [];
    const unlocked = required.some((p) => activePackageDefIds.has(p.packageDefinitionId));
    if (unlocked) return { locked: false, reason: null };
    return { locked: true, reason: 'Bu içerik yalnızca belirli paket sahiplerine açıktır' };
  }

  private toDTO(content: {
    id: string;
    studioId: string;
    title: string;
    description: string | null;
    durationSeconds: number;
    provider: string;
    sourceUrl: string | null;
    thumbnailUrl: string | null;
    serviceTypeId: string | null;
    serviceType?: { name: string } | null;
    trainerProfileId: string | null;
    trainerProfile?: { membership: { user: { firstName: string; lastName: string } } } | null;
    visibility: string;
    packages?: { packageDefinitionId: string }[];
    creditCost: number | null;
    isPublished: boolean;
    publishedAt: Date | null;
    createdAt: Date;
  }): VideoContentDTO {
    return {
      id: content.id,
      studioId: content.studioId,
      title: content.title,
      description: content.description,
      durationSeconds: content.durationSeconds,
      provider: content.provider as VideoContentDTO['provider'],
      sourceUrl: content.sourceUrl,
      thumbnailUrl: content.thumbnailUrl,
      serviceTypeId: content.serviceTypeId,
      serviceTypeName: content.serviceType?.name ?? null,
      trainerProfileId: content.trainerProfileId,
      trainerName: content.trainerProfile
        ? `${content.trainerProfile.membership.user.firstName} ${content.trainerProfile.membership.user.lastName}`.trim()
        : null,
      visibility: content.visibility as VideoContentDTO['visibility'],
      packageDefinitionIds: (content.packages ?? []).map((p) => p.packageDefinitionId),
      creditCost: content.creditCost,
      isPublished: content.isPublished,
      publishedAt: content.publishedAt?.toISOString() ?? null,
      createdAt: content.createdAt.toISOString(),
    };
  }
}
