import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@platform/database';
import {
  GOOD_RATING_THRESHOLD,
  LOW_RATING_THRESHOLD,
  RateBookingInput,
  RateBookingResultDTO,
  RatingAggregateDTO,
  RatingListResultDTO,
  SessionRatingDTO,
  isWithinRatingEditWindow,
  isWithinRatingWindow,
  type ListRatingsQueryInput,
} from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../auth/tenant-context';
import { assertBranchAccess } from '../branches/branch-access';
import { NotificationsService } from '../notifications/notifications.service';

type RatingRow = Prisma.SessionRatingGetPayload<{
  include: {
    member: { include: { membership: { include: { user: true } } } };
    trainerProfile: { include: { membership: { include: { user: true } } } };
    serviceType: true;
  };
}>;

@Injectable()
export class RatingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------------------------------------------------------------------
  // Member self-service
  // ---------------------------------------------------------------------

  /** Rate an own ATTENDED booking, once, within the rating window. */
  async rate(tenant: TenantContext, bookingId: string, dto: RateBookingInput): Promise<RateBookingResultDTO> {
    if (!tenant.memberProfileId) throw new ForbiddenException('Bu işlemi yalnızca üyeler yapabilir');

    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, studioId: tenant.studioId, memberId: tenant.memberProfileId },
      include: { schedule: true, rating: true },
    });
    if (!booking) throw new NotFoundException('Rezervasyon bulunamadı');
    if (booking.status !== 'ATTENDED') {
      throw new BadRequestException('Yalnızca katıldığınız seanslar puanlanabilir');
    }
    if (!booking.schedule.trainerId) {
      throw new BadRequestException('Bu seans için eğitmen bilgisi bulunamadığından puanlanamıyor');
    }

    const now = new Date();
    if (!isWithinRatingWindow(booking.schedule.endTime, now)) {
      throw new BadRequestException('Puanlama süresi (seans sonrası 7 gün) dolmuş');
    }
    if (booking.rating) {
      throw new ConflictException('Bu seansı zaten puanladınız');
    }

    const comment = dto.comment && dto.comment.length > 0 ? dto.comment : null;

    let rating;
    try {
      rating = await this.prisma.sessionRating.create({
        data: {
          studioId: tenant.studioId,
          bookingId: booking.id,
          memberId: tenant.memberProfileId,
          trainerProfileId: booking.schedule.trainerId,
          serviceTypeId: booking.schedule.serviceTypeId,
          score: dto.score,
          comment,
        },
        include: {
          member: { include: { membership: { include: { user: true } } } },
          trainerProfile: { include: { membership: { include: { user: true } } } },
          serviceType: true,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Bu seansı zaten puanladınız');
      }
      throw err;
    }

    if (dto.score <= LOW_RATING_THRESHOLD) {
      await this.notifyOwnersOfLowRating(tenant.studioId, rating);
    }

    const reviewPrompt = await this.buildReviewPrompt(tenant.studioId, dto.score);

    return { rating: this.toDto(rating, { revealMember: true }), reviewPrompt };
  }

  /** Edit an own rating within the edit window. */
  async edit(tenant: TenantContext, bookingId: string, dto: RateBookingInput): Promise<RateBookingResultDTO> {
    if (!tenant.memberProfileId) throw new ForbiddenException('Bu işlemi yalnızca üyeler yapabilir');

    const existing = await this.prisma.sessionRating.findFirst({
      where: { bookingId, studioId: tenant.studioId, memberId: tenant.memberProfileId },
    });
    if (!existing) throw new NotFoundException('Değerlendirme bulunamadı');
    if (!isWithinRatingEditWindow(existing.createdAt, new Date())) {
      throw new BadRequestException('Değerlendirme yalnızca ilk 24 saat içinde düzenlenebilir');
    }

    const comment = dto.comment && dto.comment.length > 0 ? dto.comment : null;
    const rating = await this.prisma.sessionRating.update({
      where: { id: existing.id },
      data: { score: dto.score, comment },
      include: {
        member: { include: { membership: { include: { user: true } } } },
        trainerProfile: { include: { membership: { include: { user: true } } } },
        serviceType: true,
      },
    });

    if (dto.score <= LOW_RATING_THRESHOLD && existing.score > LOW_RATING_THRESHOLD) {
      await this.notifyOwnersOfLowRating(tenant.studioId, rating);
    }

    const reviewPrompt = await this.buildReviewPrompt(tenant.studioId, dto.score);
    return { rating: this.toDto(rating, { revealMember: true }), reviewPrompt };
  }

  /** Attended, unrated sessions still inside the rating window (home screen prompt card). */
  async myPendingPrompts(tenant: TenantContext) {
    if (!tenant.memberProfileId) throw new ForbiddenException('Bu işlemi yalnızca üyeler yapabilir');
    const now = new Date();
    const bookings = await this.prisma.booking.findMany({
      where: {
        studioId: tenant.studioId,
        memberId: tenant.memberProfileId,
        status: 'ATTENDED',
        rating: null,
        schedule: { endTime: { lte: now } },
      },
      include: { schedule: { include: { serviceType: true, trainer: { include: { membership: { include: { user: true } } } } } } },
      orderBy: { schedule: { endTime: 'desc' } },
      take: 20,
    });
    return bookings
      .filter((b) => isWithinRatingWindow(b.schedule.endTime, now))
      .map((b) => ({
        bookingId: b.id,
        serviceTypeName: b.schedule.serviceType.name,
        trainerName: b.schedule.trainer ? `${b.schedule.trainer.membership.user.firstName} ${b.schedule.trainer.membership.user.lastName}` : '',
        sessionEndTime: b.schedule.endTime.toISOString(),
      }));
  }

  /** The caller's own given ratings. */
  async myRatings(tenant: TenantContext): Promise<SessionRatingDTO[]> {
    if (!tenant.memberProfileId) throw new ForbiddenException('Bu işlemi yalnızca üyeler yapabilir');
    const rows = await this.prisma.sessionRating.findMany({
      where: { studioId: tenant.studioId, memberId: tenant.memberProfileId },
      include: {
        member: { include: { membership: { include: { user: true } } } },
        trainerProfile: { include: { membership: { include: { user: true } } } },
        serviceType: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toDto(r, { revealMember: true }));
  }

  // ---------------------------------------------------------------------
  // Trainer self-service: own aggregate, anonymized comments
  // ---------------------------------------------------------------------

  async myReceivedSummary(tenant: TenantContext): Promise<RatingListResultDTO> {
    if (!tenant.trainerProfileId) throw new ForbiddenException('Bu işlemi yalnızca eğitmenler yapabilir');
    const rows = await this.prisma.sessionRating.findMany({
      where: { studioId: tenant.studioId, trainerProfileId: tenant.trainerProfileId },
      include: {
        member: { include: { membership: { include: { user: true } } } },
        trainerProfile: { include: { membership: { include: { user: true } } } },
        serviceType: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    const items = rows.map((r) => this.toDto(r, { revealMember: !r.isAnonymousToTrainer }));
    return { items, aggregate: this.aggregate(rows.map((r) => r.score)), page: 1, pageSize: items.length, total: items.length };
  }

  // ---------------------------------------------------------------------
  // Staff / owner: full listing with filters and averages
  // ---------------------------------------------------------------------

  async list(tenant: TenantContext, query: ListRatingsQueryInput): Promise<RatingListResultDTO> {
    if (query.branchId) assertBranchAccess(tenant, query.branchId);

    const branchFilter =
      query.branchId != null
        ? { schedule: { branchId: query.branchId } }
        : tenant.branchIds !== null
          ? { schedule: { branchId: { in: [...tenant.branchIds] } } }
          : {};

    const where: Prisma.SessionRatingWhereInput = {
      studioId: tenant.studioId,
      ...(query.trainerProfileId ? { trainerProfileId: query.trainerProfileId } : {}),
      ...(query.serviceTypeId ? { serviceTypeId: query.serviceTypeId } : {}),
      ...(query.from || query.to
        ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } }
        : {}),
      booking: branchFilter,
    };

    const [rows, total, allForAggregate] = await Promise.all([
      this.prisma.sessionRating.findMany({
        where,
        include: {
          member: { include: { membership: { include: { user: true } } } },
          trainerProfile: { include: { membership: { include: { user: true } } } },
          serviceType: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.sessionRating.count({ where }),
      this.prisma.sessionRating.findMany({ where, select: { score: true } }),
    ]);

    return {
      items: rows.map((r) => this.toDto(r, { revealMember: true })),
      aggregate: this.aggregate(allForAggregate.map((r) => r.score)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  private aggregate(scores: number[]): RatingAggregateDTO {
    const distribution: RatingAggregateDTO['distribution'] = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    for (const s of scores) {
      const key = String(s) as keyof typeof distribution;
      if (key in distribution) distribution[key] += 1;
    }
    const count = scores.length;
    const average = count > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / count) * 100) / 100 : null;
    return { count, average, distribution };
  }

  private async buildReviewPrompt(studioId: string, score: number) {
    if (score < GOOD_RATING_THRESHOLD) return null;
    const studio = await this.prisma.studio.findUnique({ where: { id: studioId }, select: { googleReviewUrl: true } });
    if (!studio?.googleReviewUrl) return null;
    return { googleReviewUrl: studio.googleReviewUrl };
  }

  private async notifyOwnersOfLowRating(studioId: string, rating: RatingRow) {
    const owners = await this.prisma.membership.findMany({
      where: { studioId, status: 'ACTIVE', roleTemplate: { isOwner: true } },
      select: { userId: true },
    });
    const trainerName = `${rating.trainerProfile.membership.user.firstName} ${rating.trainerProfile.membership.user.lastName}`;
    for (const owner of owners) {
      await this.notifications.notifyUser({
        userId: owner.userId,
        studioId,
        category: 'FEEDBACK',
        message: {
          title: 'Düşük puanlı bir değerlendirme geldi',
          body: `${trainerName} - ${rating.score}/5${rating.comment ? `: "${rating.comment}"` : ''}`,
          data: { type: 'RATING_LOW', ratingId: rating.id },
        },
      });
    }
  }

  private toDto(row: RatingRow, options: { revealMember: boolean }): SessionRatingDTO {
    return {
      id: row.id,
      bookingId: row.bookingId,
      memberId: row.memberId,
      memberName: options.revealMember ? `${row.member.membership.user.firstName} ${row.member.membership.user.lastName}` : null,
      trainerProfileId: row.trainerProfileId,
      trainerName: `${row.trainerProfile.membership.user.firstName} ${row.trainerProfile.membership.user.lastName}`,
      serviceTypeId: row.serviceTypeId,
      serviceTypeName: row.serviceType.name,
      branchId: null,
      score: row.score,
      comment: row.comment,
      isAnonymousToTrainer: row.isAnonymousToTrainer,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
