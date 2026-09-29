import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@platform/database';
import type { MarketingSettings } from '@platform/database';
import { MARKETING_SETTINGS_DEFAULTS, SegmentGroupSchema, contactDisplayName } from '@platform/shared';
import type {
  MarketingSettingsDTO,
  MarketingSettingsRecipientDTO,
  MarketingSettingsViewDTO,
  SegmentGroup,
  UpdateMarketingSettingsInput,
} from '@platform/shared';
import { PrismaService } from '../../../prisma/prisma.service';

function segmentRule(raw: Prisma.JsonValue | null): SegmentGroup | null {
  if (raw === null) return null;
  const parsed = SegmentGroupSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function moneyMap(raw: Prisma.JsonValue): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === 'string'));
}

function idList(raw: Prisma.JsonValue): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
}

export function toMarketingSettingsDto(row: MarketingSettings | null): MarketingSettingsDTO {
  if (!row) {
    return {
      ...MARKETING_SETTINGS_DEFAULTS,
      monthlyAdSpendCaps: {},
      weeklySummaryRecipients: [],
      updatedByUserId: null,
      updatedAt: null,
    };
  }
  return {
    selfApproveEmailMax: row.selfApproveEmailMax,
    selfApproveSmsMax: row.selfApproveSmsMax,
    selfApproveSmsCredits: row.selfApproveSmsCredits,
    requireApprovalForSocial: row.requireApprovalForSocial,
    dailyEmailCap: row.dailyEmailCap,
    dailySmsCreditCap: row.dailySmsCreditCap,
    monthlyAdSpendCaps: moneyMap(row.monthlyAdSpendCaps),
    aiDailyCapCents: row.aiDailyCapCents,
    bounceAutoPausePct: Number(row.bounceAutoPausePct),
    complaintAutoPausePct: Number(row.complaintAutoPausePct),
    mqlRule: segmentRule(row.mqlRule),
    sqlRule: segmentRule(row.sqlRule),
    weeklySummaryEnabled: row.weeklySummaryEnabled,
    weeklySummaryRecipients: idList(row.weeklySummaryRecipients),
    approvalTtlHours: row.approvalTtlHours,
    updatedByUserId: row.updatedByUserId,
    updatedAt: row.updatedAt.toISOString(),
  };
}

const jsonOrNull = (v: SegmentGroup | null): Prisma.InputJsonValue | typeof Prisma.DbNull => (v === null ? Prisma.DbNull : (v as unknown as Prisma.InputJsonValue));

/**
 * MarketingSettings (docs/PAZARLAMA_MODULU.md 6.2, 7.4): one row per tenant,
 * written only for the platform tenant by the super admin. A tenant without
 * a row uses MARKETING_SETTINGS_DEFAULTS. Every change is audit logged with
 * the old and new value of each changed field.
 */
@Injectable()
export class MarketingSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async platformStudioId(): Promise<string> {
    const studio = await this.prisma.studio.findFirst({ where: { isPlatform: true }, select: { id: true } });
    if (!studio) throw new NotFoundException('Platform kiracısı bulunamadı');
    return studio.id;
  }

  async get(studioId: string): Promise<MarketingSettingsDTO> {
    return toMarketingSettingsDto(await this.prisma.marketingSettings.findUnique({ where: { studioId } }));
  }

  async view(studioId: string): Promise<MarketingSettingsViewDTO> {
    return { settings: await this.get(studioId), recipients: await this.recipients() };
  }

  /** Platform-level accounts (super admins and active platform members) that may receive the weekly summary. */
  async recipients(): Promise<MarketingSettingsRecipientDTO[]> {
    const users = await this.prisma.user.findMany({
      where: { isActive: true, OR: [{ isSuperAdmin: true }, { platformMembership: { is: { status: 'ACTIVE' } } }] },
      select: { id: true, firstName: true, lastName: true, isSuperAdmin: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      take: 100,
    });
    return users.map((u) => ({ userId: u.id, name: contactDisplayName(u), isSuperAdmin: u.isSuperAdmin }));
  }

  async update(studioId: string, userId: string, input: UpdateMarketingSettingsInput): Promise<MarketingSettingsViewDTO> {
    if (input.weeklySummaryRecipients) {
      const allowed = new Set((await this.recipients()).map((r) => r.userId));
      if (input.weeklySummaryRecipients.some((id) => !allowed.has(id))) {
        throw new BadRequestException('Özet alıcıları yalnızca platform kullanıcıları olabilir');
      }
    }
    const before = await this.get(studioId);
    const data: Prisma.MarketingSettingsUncheckedUpdateInput = {
      ...(input.selfApproveEmailMax !== undefined ? { selfApproveEmailMax: input.selfApproveEmailMax } : {}),
      ...(input.selfApproveSmsMax !== undefined ? { selfApproveSmsMax: input.selfApproveSmsMax } : {}),
      ...(input.selfApproveSmsCredits !== undefined ? { selfApproveSmsCredits: input.selfApproveSmsCredits } : {}),
      ...(input.requireApprovalForSocial !== undefined ? { requireApprovalForSocial: input.requireApprovalForSocial } : {}),
      ...(input.dailyEmailCap !== undefined ? { dailyEmailCap: input.dailyEmailCap } : {}),
      ...(input.dailySmsCreditCap !== undefined ? { dailySmsCreditCap: input.dailySmsCreditCap } : {}),
      ...(input.monthlyAdSpendCaps !== undefined ? { monthlyAdSpendCaps: input.monthlyAdSpendCaps as Prisma.InputJsonValue } : {}),
      ...(input.aiDailyCapCents !== undefined ? { aiDailyCapCents: input.aiDailyCapCents } : {}),
      ...(input.bounceAutoPausePct !== undefined ? { bounceAutoPausePct: new Prisma.Decimal(input.bounceAutoPausePct) } : {}),
      ...(input.complaintAutoPausePct !== undefined ? { complaintAutoPausePct: new Prisma.Decimal(input.complaintAutoPausePct) } : {}),
      ...(input.mqlRule !== undefined ? { mqlRule: jsonOrNull(input.mqlRule) } : {}),
      ...(input.sqlRule !== undefined ? { sqlRule: jsonOrNull(input.sqlRule) } : {}),
      ...(input.weeklySummaryEnabled !== undefined ? { weeklySummaryEnabled: input.weeklySummaryEnabled } : {}),
      ...(input.weeklySummaryRecipients !== undefined ? { weeklySummaryRecipients: input.weeklySummaryRecipients } : {}),
      ...(input.approvalTtlHours !== undefined ? { approvalTtlHours: input.approvalTtlHours } : {}),
      updatedByUserId: userId,
    };
    const createData = { ...data, studioId } as Prisma.MarketingSettingsUncheckedCreateInput;

    const row = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.marketingSettings.upsert({ where: { studioId }, create: createData, update: data });
      const after = toMarketingSettingsDto(saved);
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const key of Object.keys(input) as (keyof UpdateMarketingSettingsInput)[]) {
        if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changes[key] = { from: before[key], to: after[key] };
      }
      await tx.auditLog.create({
        data: {
          studioId,
          userId,
          action: 'marketing.settings.updated',
          entityType: 'MarketingSettings',
          entityId: studioId,
          metadata: { changes } as Prisma.InputJsonValue,
        },
      });
      return saved;
    });
    return { settings: toMarketingSettingsDto(row), recipients: await this.recipients() };
  }
}
