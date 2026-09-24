import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, DocumentType, BookingStatus } from '@prisma/client';
import type {
  AcceptHealthConsentInput,
  CreateHealthSyncRecordInput,
  HealthConsentStatusDTO,
  HealthDailySummaryDTO,
  HealthSettingsDTO,
  HealthSyncRecordDTO,
  MemberHealthTrendDTO,
  PendingHealthWorkoutDTO,
  UpdateHealthSettingsInput,
  UpsertHealthSummariesInput,
} from '@platform/shared';
import { HealthActivityType as SharedHealthActivityType } from '@platform/shared';
import { HealthPlatform as SharedHealthPlatform } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../auth/tenant-context';
import { assertBranchAccess } from '../branches/branch-access';

/**
 * Apple Health / Android Health Connect integration (W21). Health data is
 * special-category personal data under KVKK: every write path here checks
 * the member's own privacy toggle AND an active HEALTH_DATA consent, and the
 * member can delete every server-side row at any time.
 */
@Injectable()
export class MemberHealthService {
  constructor(private readonly prisma: PrismaService) {}

  /** The caller's own MemberProfile id, or 403 for staff-only memberships. */
  private requireMemberId(tenant: TenantContext): string {
    if (!tenant.memberProfileId) {
      throw new ForbiddenException('Bu özellik yalnızca üyeler içindir');
    }
    return tenant.memberProfileId;
  }

  // -- Consent --------------------------------------------------------------

  /** Latest published HEALTH_DATA document; a studio's own text wins over the platform default. */
  private async latestHealthDataDocument(studioId: string) {
    const docs = await this.prisma.documentVersion.findMany({
      where: {
        type: DocumentType.HEALTH_DATA,
        publishedAt: { not: null, lte: new Date() },
        OR: [{ studioId }, { studioId: null }],
      },
      orderBy: [{ version: 'desc' }],
    });
    return docs.find((d) => d.studioId === studioId) ?? docs.find((d) => d.studioId === null) ?? null;
  }

  async getConsentStatus(tenant: TenantContext): Promise<HealthConsentStatusDTO> {
    this.requireMemberId(tenant);
    const doc = await this.latestHealthDataDocument(tenant.studioId);
    if (!doc || !tenant.membershipId) {
      return { hasActiveConsent: false, documentVersionId: null, version: null, acceptedAt: null };
    }
    const consent = await this.prisma.consent.findUnique({
      where: { membershipId_documentVersionId: { membershipId: tenant.membershipId, documentVersionId: doc.id } },
    });
    return {
      hasActiveConsent: Boolean(consent),
      documentVersionId: doc.id,
      version: doc.version,
      acceptedAt: consent?.acceptedAt.toISOString() ?? null,
    };
  }

  async acceptConsent(
    tenant: TenantContext,
    dto: AcceptHealthConsentInput,
    ip: string | null,
  ): Promise<HealthConsentStatusDTO> {
    this.requireMemberId(tenant);
    if (!tenant.membershipId) throw new ForbiddenException('Bu özellik yalnızca üyeler içindir');
    const doc = await this.latestHealthDataDocument(tenant.studioId);
    if (!doc) {
      throw new NotFoundException('Sağlık verisi onam metni yayınlanmamış');
    }
    await this.prisma.consent.upsert({
      where: { membershipId_documentVersionId: { membershipId: tenant.membershipId, documentVersionId: doc.id } },
      create: {
        membershipId: tenant.membershipId,
        documentVersionId: doc.id,
        device: dto.device ?? null,
        ip: ip ?? null,
      },
      update: {},
    });
    return this.getConsentStatus(tenant);
  }

  private async assertActiveConsent(tenant: TenantContext): Promise<void> {
    const status = await this.getConsentStatus(tenant);
    if (!status.hasActiveConsent) {
      throw new ForbiddenException('Önce sağlık verisi paylaşımı için onay vermelisiniz');
    }
  }

  // -- Settings ---------------------------------------------------------------

  async getSettings(tenant: TenantContext): Promise<HealthSettingsDTO> {
    const memberId = this.requireMemberId(tenant);
    const [settings, consent] = await Promise.all([
      this.prisma.memberHealthSettings.findUnique({ where: { memberId } }),
      this.getConsentStatus(tenant),
    ]);
    return {
      writeWorkouts: settings?.writeWorkouts ?? false,
      readAggregates: settings?.readAggregates ?? false,
      shareWithStudio: settings?.shareWithStudio ?? false,
      hasActiveConsent: consent.hasActiveConsent,
    };
  }

  async updateSettings(tenant: TenantContext, dto: UpdateHealthSettingsInput): Promise<HealthSettingsDTO> {
    const memberId = this.requireMemberId(tenant);
    // Turning any toggle on requires an explicit, active consent on file.
    if (dto.writeWorkouts || dto.readAggregates || dto.shareWithStudio) {
      await this.assertActiveConsent(tenant);
    }
    // shareWithStudio without readAggregates would upload nothing meaningful.
    const shareWithStudio = dto.shareWithStudio && dto.readAggregates;
    await this.prisma.memberHealthSettings.upsert({
      where: { memberId },
      create: {
        memberId,
        studioId: tenant.studioId,
        writeWorkouts: dto.writeWorkouts,
        readAggregates: dto.readAggregates,
        shareWithStudio,
      },
      update: {
        writeWorkouts: dto.writeWorkouts,
        readAggregates: dto.readAggregates,
        shareWithStudio,
      },
    });
    return this.getSettings(tenant);
  }

  // -- Daily aggregate upload -------------------------------------------------

  async upsertSummaries(tenant: TenantContext, dto: UpsertHealthSummariesInput): Promise<{ upserted: number }> {
    const memberId = this.requireMemberId(tenant);
    await this.assertActiveConsent(tenant);

    const settings = await this.prisma.memberHealthSettings.findUnique({ where: { memberId } });
    if (!settings?.readAggregates || !settings.shareWithStudio) {
      throw new ForbiddenException('Sağlık verisi paylaşımı açık değil');
    }

    await this.prisma.$transaction(
      dto.summaries.map((entry) =>
        this.prisma.healthDailySummary.upsert({
          where: { memberId_date: { memberId, date: new Date(entry.date) } },
          create: {
            memberId,
            studioId: tenant.studioId,
            date: new Date(entry.date),
            steps: entry.steps ?? null,
            activeEnergyKcal: entry.activeEnergyKcal != null ? new Prisma.Decimal(entry.activeEnergyKcal) : null,
            restingHeartRate: entry.restingHeartRate ?? null,
          },
          update: {
            steps: entry.steps ?? null,
            activeEnergyKcal: entry.activeEnergyKcal != null ? new Prisma.Decimal(entry.activeEnergyKcal) : null,
            restingHeartRate: entry.restingHeartRate ?? null,
          },
        }),
      ),
    );
    return { upserted: dto.summaries.length };
  }

  async getMySummaries(tenant: TenantContext, days = 30): Promise<HealthDailySummaryDTO[]> {
    const memberId = this.requireMemberId(tenant);
    const since = new Date();
    since.setDate(since.getDate() - days);
    const rows = await this.prisma.healthDailySummary.findMany({
      where: { memberId, date: { gte: since } },
      orderBy: { date: 'asc' },
    });
    return rows.map(toSummaryDto);
  }

  // -- Sync records (idempotent workout write tracking) -----------------------

  async listSyncRecords(tenant: TenantContext): Promise<HealthSyncRecordDTO[]> {
    const memberId = this.requireMemberId(tenant);
    const rows = await this.prisma.healthSyncRecord.findMany({
      where: { memberId },
      orderBy: { syncedAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      bookingId: r.bookingId,
      platform: r.platform as unknown as SharedHealthPlatform,
      syncedAt: r.syncedAt.toISOString(),
    }));
  }

  async createSyncRecord(tenant: TenantContext, dto: CreateHealthSyncRecordInput): Promise<HealthSyncRecordDTO> {
    const memberId = this.requireMemberId(tenant);
    await this.assertActiveConsent(tenant);

    const settings = await this.prisma.memberHealthSettings.findUnique({ where: { memberId } });
    if (!settings?.writeWorkouts) {
      throw new ForbiddenException('Sağlığa antrenman yazma özelliği açık değil');
    }

    const booking = await this.prisma.booking.findFirst({
      where: { id: dto.bookingId, studioId: tenant.studioId, memberId },
    });
    if (!booking) throw new NotFoundException('Rezervasyon bulunamadı');
    if (booking.status !== BookingStatus.ATTENDED) {
      throw new ForbiddenException('Yalnızca katılım sağlanmış seanslar sağlığa yazılabilir');
    }

    // Idempotent: a prior record for this (member, booking, platform) is
    // simply returned instead of writing (or reporting) a duplicate.
    const existing = await this.prisma.healthSyncRecord.findUnique({
      where: { memberId_bookingId_platform: { memberId, bookingId: dto.bookingId, platform: dto.platform } },
    });
    const record =
      existing ??
      (await this.prisma.healthSyncRecord.create({
        data: { studioId: tenant.studioId, memberId, bookingId: dto.bookingId, platform: dto.platform },
      }));

    return {
      id: record.id,
      bookingId: record.bookingId,
      platform: record.platform as unknown as SharedHealthPlatform,
      syncedAt: record.syncedAt.toISOString(),
    };
  }

  /**
   * Attended bookings from the last 14 days, for the app to compare against
   * its local + server sync-record cache and write whichever are still
   * missing. Empty unless writeWorkouts is on and consent is active.
   */
  async getPendingWorkouts(tenant: TenantContext): Promise<PendingHealthWorkoutDTO[]> {
    const memberId = this.requireMemberId(tenant);
    const settings = await this.prisma.memberHealthSettings.findUnique({ where: { memberId } });
    const consent = await this.getConsentStatus(tenant);
    if (!settings?.writeWorkouts || !consent.hasActiveConsent) return [];

    const since = new Date();
    since.setDate(since.getDate() - 14);
    const bookings = await this.prisma.booking.findMany({
      where: { memberId, studioId: tenant.studioId, status: BookingStatus.ATTENDED, schedule: { startTime: { gte: since } } },
      include: { schedule: { include: { serviceType: { select: { healthActivityType: true } } } } },
      orderBy: { schedule: { startTime: 'asc' } },
    });
    return bookings.map((b) => ({
      bookingId: b.id,
      healthActivityType: (b.schedule.serviceType?.healthActivityType ??
        SharedHealthActivityType.OTHER) as unknown as SharedHealthActivityType,
      startTime: b.schedule.startTime.toISOString(),
      endTime: b.schedule.endTime.toISOString(),
    }));
  }

  // -- Delete everything (KVKK right to erasure for this special category) ---

  async deleteAllData(tenant: TenantContext, actorUserId: string): Promise<{ deleted: true }> {
    const memberId = this.requireMemberId(tenant);

    await this.prisma.$transaction(async (tx) => {
      const [summaries, syncRecords] = await Promise.all([
        tx.healthDailySummary.deleteMany({ where: { memberId } }),
        tx.healthSyncRecord.deleteMany({ where: { memberId } }),
      ]);
      await tx.memberHealthSettings.upsert({
        where: { memberId },
        create: { memberId, studioId: tenant.studioId, writeWorkouts: false, readAggregates: false, shareWithStudio: false },
        update: { writeWorkouts: false, readAggregates: false, shareWithStudio: false },
      });
      // Revoking consent: the member must accept again before any future sync.
      if (tenant.membershipId) {
        await tx.consent.deleteMany({
          where: { membershipId: tenant.membershipId, documentVersion: { type: DocumentType.HEALTH_DATA } },
        });
      }
      await tx.auditLog.create({
        data: {
          studioId: tenant.studioId,
          userId: actorUserId,
          action: 'member_health.data_deleted',
          entityType: 'MemberProfile',
          entityId: memberId,
          metadata: {
            deletedSummaries: summaries.count,
            deletedSyncRecords: syncRecords.count,
          } as Prisma.InputJsonValue,
        },
      });
    });

    return { deleted: true };
  }

  // -- Staff view --------------------------------------------------------------

  async staffGetMemberHealth(tenant: TenantContext, memberId: string, days = 30): Promise<MemberHealthTrendDTO> {
    const member = await this.prisma.memberProfile.findFirst({
      where: { id: memberId, studioId: tenant.studioId },
      select: { id: true, homeBranchId: true },
    });
    if (!member) throw new NotFoundException('Üye bulunamadı');
    assertBranchAccess(tenant, member.homeBranchId);

    const settings = await this.prisma.memberHealthSettings.findUnique({ where: { memberId } });
    if (!settings?.shareWithStudio) {
      return { memberId, shareWithStudio: false, summaries: [] };
    }

    const since = new Date();
    since.setDate(since.getDate() - days);
    const rows = await this.prisma.healthDailySummary.findMany({
      where: { memberId, date: { gte: since } },
      orderBy: { date: 'asc' },
    });
    return { memberId, shareWithStudio: true, summaries: rows.map(toSummaryDto) };
  }
}

function toSummaryDto(row: {
  date: Date;
  steps: number | null;
  activeEnergyKcal: Prisma.Decimal | null;
  restingHeartRate: number | null;
}): HealthDailySummaryDTO {
  return {
    date: row.date.toISOString().slice(0, 10),
    steps: row.steps,
    activeEnergyKcal: row.activeEnergyKcal != null ? Number(row.activeEnergyKcal) : null,
    restingHeartRate: row.restingHeartRate,
  };
}
