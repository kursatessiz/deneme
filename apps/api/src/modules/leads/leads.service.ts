import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@platform/database';
import { PrismaService } from '../prisma/prisma.service';
import { MembersService } from '../members/members.service';
import { SchedulesService } from '../schedules/schedules.service';
import type { TenantContext } from '../auth/tenant-context';
import { assertBranchAccess, branchScope } from '../branches/branch-access';
import {
  AddLeadActivityInput,
  AssignLeadOwnerInput,
  BookLeadTrialInput,
  ChangeLeadStageInput,
  ConvertLeadInput,
  CreateLeadInput,
  LeadListQuery,
  LeadSource,
  LeadStage,
  PublicLeadFormInput,
  UpdateLeadInput,
  canTransitionLeadStage,
} from '@platform/shared';

@Injectable()
export class LeadsService {
  constructor(
    private prisma: PrismaService,
    private members: MembersService,
    private schedules: SchedulesService,
  ) {}

  async findAll(tenant: TenantContext, query: LeadListQuery) {
    const studioId = tenant.studioId;
    const scope = branchScope(tenant, query.branchId);

    const where = {
      studioId,
      ...scope,
      ...(query.stage ? { stage: query.stage } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.ownerMembershipId ? { ownerMembershipId: query.ownerMembershipId } : {}),
      ...(query.overdue
        ? { nextFollowUpAt: { lt: new Date() }, stage: { notIn: [LeadStage.WON, LeadStage.LOST] } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { fullName: { contains: query.search, mode: 'insensitive' as const } },
              { phone: { contains: query.search } },
            ],
          }
        : {}),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.lead.count({ where }),
      this.prisma.lead.findMany({
        where,
        include: { ownerMembership: { include: { user: true } }, interestServiceType: true },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    return {
      items: items.map((l) => this.toDetail(l)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async findById(tenant: TenantContext, leadId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, studioId: tenant.studioId },
      include: {
        ownerMembership: { include: { user: true } },
        interestServiceType: true,
        activities: {
          include: { actorMembership: { include: { user: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!lead) throw new NotFoundException('Potansiyel üye bulunamadı');
    assertBranchAccess(tenant, lead.branchId);
    return this.toDetail(lead, true);
  }

  async create(tenant: TenantContext, dto: CreateLeadInput) {
    const studioId = tenant.studioId;
    if (dto.branchId) assertBranchAccess(tenant, dto.branchId);
    if (dto.ownerMembershipId) await this.assertStaffMembership(studioId, dto.ownerMembershipId);

    const open = await this.prisma.lead.findFirst({
      where: { studioId, phone: dto.phone, stage: { notIn: [LeadStage.WON, LeadStage.LOST] } },
    });
    if (open) {
      // Same open-phone rule as the public form: fold into an activity.
      const activity = await this.prisma.leadActivity.create({
        data: {
          leadId: open.id,
          studioId,
          type: 'NOTE',
          body: `Tekrar başvuru: ${dto.notes ?? dto.sourceDetail ?? dto.source}`,
          actorMembershipId: tenant.membershipId,
        },
      });
      return { lead: this.toDetail(open), activity, deduplicated: true };
    }

    const lead = await this.prisma.lead.create({
      data: {
        studioId,
        branchId: dto.branchId ?? null,
        fullName: dto.fullName,
        phone: dto.phone,
        openPhone: dto.phone,
        email: dto.email || null,
        source: dto.source,
        sourceDetail: dto.sourceDetail ?? null,
        interestServiceTypeId: dto.interestServiceTypeId ?? null,
        ownerMembershipId: dto.ownerMembershipId ?? null,
        nextFollowUpAt: dto.nextFollowUpAt ? new Date(dto.nextFollowUpAt) : null,
        utmSource: dto.utmSource ?? null,
        utmMedium: dto.utmMedium ?? null,
        utmCampaign: dto.utmCampaign ?? null,
        notes: dto.notes ?? null,
      },
      include: { ownerMembership: { include: { user: true } }, interestServiceType: true },
    }).catch((err: unknown) => {
      throw this.openPhoneConflict(err);
    });
    return { lead: this.toDetail(lead), deduplicated: false };
  }

  /**
   * Public web-form submission. Always resolves normally (the controller
   * turns this into a flat 202) so an unknown or inactive studio slug, a
   * honeypot hit, or a validation failure cannot be told apart from a
   * genuine success by an outside caller -- nothing is enumerable.
   */
  async submitPublicForm(slug: string, dto: PublicLeadFormInput) {
    // Honeypot: a real visitor never fills this hidden field.
    if (dto.website) return;

    const studio = await this.prisma.studio.findFirst({ where: { slug, isActive: true }, select: { id: true } });
    if (!studio) return;

    const studioId = studio.id;
    const open = await this.prisma.lead.findFirst({
      where: { studioId, phone: dto.phone, stage: { notIn: [LeadStage.WON, LeadStage.LOST] } },
    });

    if (open) {
      await this.prisma.leadActivity.create({
        data: {
          leadId: open.id,
          studioId,
          type: 'NOTE',
          body: `Web formu üzerinden tekrar başvuru${dto.interest ? `: ${dto.interest}` : ''}`,
        },
      });
      return;
    }

    let lead;
    try {
      lead = await this.prisma.lead.create({
        data: {
          studioId,
          fullName: dto.fullName,
          phone: dto.phone,
          openPhone: dto.phone,
          email: dto.email || null,
          source: dto.referralCode ? LeadSource.REFERRAL : LeadSource.WEB_FORM,
          sourceDetail: dto.interest || null,
          referralCode: dto.referralCode || null,
          notes: null,
        },
      });
    } catch (err) {
      // A simultaneous submission for the same phone won the partial unique
      // index (one open lead per phone): the request is still accepted.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return;
      throw err;
    }
    await this.prisma.leadActivity.create({
      data: {
        leadId: lead.id,
        studioId,
        type: 'NOTE',
        body: 'İletişim izni web formu üzerinden onaylandı',
      },
    });
  }

  async update(tenant: TenantContext, leadId: string, dto: UpdateLeadInput) {
    const studioId = tenant.studioId;
    const lead = await this.getOwnLead(tenant, leadId);
    if (dto.branchId !== undefined && dto.branchId !== null) assertBranchAccess(tenant, dto.branchId);
    if (dto.ownerMembershipId) await this.assertStaffMembership(studioId, dto.ownerMembershipId);

    const updated = await this.prisma.lead.update({
      where: { id: lead.id },
      data: {
        ...(dto.branchId !== undefined ? { branchId: dto.branchId } : {}),
        ...(dto.fullName !== undefined ? { fullName: dto.fullName } : {}),
        ...(dto.phone !== undefined
          ? { phone: dto.phone, openPhone: isOpenStage(lead.stage) ? dto.phone : null }
          : {}),
        ...(dto.email !== undefined ? { email: dto.email || null } : {}),
        ...(dto.source !== undefined ? { source: dto.source } : {}),
        ...(dto.sourceDetail !== undefined ? { sourceDetail: dto.sourceDetail } : {}),
        ...(dto.interestServiceTypeId !== undefined ? { interestServiceTypeId: dto.interestServiceTypeId } : {}),
        ...(dto.ownerMembershipId !== undefined ? { ownerMembershipId: dto.ownerMembershipId } : {}),
        ...(dto.nextFollowUpAt !== undefined
          ? { nextFollowUpAt: dto.nextFollowUpAt ? new Date(dto.nextFollowUpAt) : null }
          : {}),
        ...(dto.utmSource !== undefined ? { utmSource: dto.utmSource } : {}),
        ...(dto.utmMedium !== undefined ? { utmMedium: dto.utmMedium } : {}),
        ...(dto.utmCampaign !== undefined ? { utmCampaign: dto.utmCampaign } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
      include: { ownerMembership: { include: { user: true } }, interestServiceType: true },
    }).catch((err: unknown) => {
      throw this.openPhoneConflict(err);
    });
    return this.toDetail(updated);
  }

  async changeStage(tenant: TenantContext, leadId: string, dto: ChangeLeadStageInput) {
    const lead = await this.getOwnLead(tenant, leadId);
    if (!canTransitionLeadStage(lead.stage as LeadStage, dto.stage)) {
      throw new BadRequestException(`'${lead.stage}' durumundan '${dto.stage}' durumuna geçilemez`);
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.lead.update({
        where: { id: lead.id },
        data: {
          stage: dto.stage,
          lostReason: dto.stage === 'LOST' ? dto.lostReason : null,
          openPhone: isOpenStage(dto.stage) ? lead.phone : null,
        },
      });
      await tx.leadActivity.create({
        data: {
          leadId: lead.id,
          studioId: tenant.studioId,
          type: 'STAGE_CHANGE',
          body: `Aşama değişti: ${lead.stage} -> ${dto.stage}${dto.lostReason ? ` (${dto.lostReason})` : ''}`,
          actorMembershipId: tenant.membershipId,
        },
      });
      return updated;
    });
  }

  async assignOwner(tenant: TenantContext, leadId: string, dto: AssignLeadOwnerInput) {
    const lead = await this.getOwnLead(tenant, leadId);
    if (dto.ownerMembershipId) await this.assertStaffMembership(tenant.studioId, dto.ownerMembershipId);
    return this.prisma.lead.update({ where: { id: lead.id }, data: { ownerMembershipId: dto.ownerMembershipId } });
  }

  async addActivity(tenant: TenantContext, leadId: string, dto: AddLeadActivityInput) {
    const lead = await this.getOwnLead(tenant, leadId);
    return this.prisma.leadActivity.create({
      data: {
        leadId: lead.id,
        studioId: tenant.studioId,
        type: dto.type,
        body: dto.body,
        actorMembershipId: tenant.membershipId,
      },
    });
  }

  /** Converts a lead into a member: reuses or creates the global user by phone, marks the lead WON. */
  async convert(tenant: TenantContext, leadId: string, dto: ConvertLeadInput) {
    const lead = await this.getOwnLead(tenant, leadId);
    if (lead.stage === 'WON') {
      throw new BadRequestException('Bu potansiyel üye zaten üyeliğe dönüştürülmüş');
    }
    if (lead.stage === 'LOST') {
      throw new BadRequestException('Kaybedilmiş bir potansiyel üye üyeliğe dönüştürülemez');
    }

    const { firstName, lastName } = splitFullName(lead.fullName);
    const member = await this.members.createMember(tenant, {
      studioId: tenant.studioId,
      firstName,
      lastName,
      phone: lead.phone,
      email: lead.email ?? '',
      birthDate: dto.birthDate,
      emergencyContactName: dto.emergencyContactName,
      emergencyContactPhone: dto.emergencyContactPhone,
      notes: dto.notes ?? lead.notes ?? undefined,
      referralCode: lead.referralCode ?? undefined,
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.lead.update({
        where: { id: lead.id },
        data: { stage: 'WON', openPhone: null, convertedMembershipId: member.membershipId as string },
      });
      await tx.leadActivity.create({
        data: {
          leadId: lead.id,
          studioId: tenant.studioId,
          type: 'STAGE_CHANGE',
          body: `Üyeliğe dönüştürüldü: ${lead.stage} -> WON`,
          actorMembershipId: tenant.membershipId,
        },
      });
      return u;
    });

    return { lead: updated, member };
  }

  /** Creates the member (as convert() does) and books a trial session, moving the lead to TRIAL_BOOKED. */
  async bookTrial(tenant: TenantContext, leadId: string, dto: BookLeadTrialInput) {
    const lead = await this.getOwnLead(tenant, leadId);
    if (lead.stage === 'WON' || lead.stage === 'LOST') {
      throw new BadRequestException('Bu aşamadaki bir potansiyel üye için deneme dersi ayarlanamaz');
    }

    const { firstName, lastName } = splitFullName(lead.fullName);
    const member = await this.members.createMember(tenant, {
      studioId: tenant.studioId,
      firstName,
      lastName,
      phone: lead.phone,
      email: lead.email ?? '',
      notes: lead.notes ?? undefined,
      referralCode: lead.referralCode ?? undefined,
    });

    const booking = await this.schedules.bookSession(tenant, {
      studioId: tenant.studioId,
      scheduleId: dto.scheduleId,
      memberId: member.id as string,
      resourceIds: [],
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.lead.update({
        where: { id: lead.id },
        data: { stage: 'TRIAL_BOOKED' },
      });
      await tx.leadActivity.create({
        data: {
          leadId: lead.id,
          studioId: tenant.studioId,
          type: 'TRIAL_BOOKED',
          body: 'Deneme dersi planlandı',
          actorMembershipId: tenant.membershipId,
        },
      });
      return u;
    });

    return { lead: updated, member, booking };
  }

  /** Maps the one-open-lead-per-phone constraint to a clear 409. */
  private openPhoneConflict(err: unknown): unknown {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return new ConflictException('Bu telefon numarasıyla açık bir potansiyel üye zaten var');
    }
    return err;
  }

  private async getOwnLead(tenant: TenantContext, leadId: string) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, studioId: tenant.studioId } });
    if (!lead) throw new NotFoundException('Potansiyel üye bulunamadı');
    assertBranchAccess(tenant, lead.branchId);
    return lead;
  }

  private async assertStaffMembership(studioId: string, membershipId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, studioId, status: 'ACTIVE' },
      include: { roleTemplate: true },
    });
    if (!membership || membership.roleTemplate.key === 'member') {
      throw new BadRequestException('Sorumlu personel bu işletmede aktif bir personel üyeliği olmalıdır');
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma include result, shaped for the response
  private toDetail(lead: any, includeActivities = false) {
    const owner = lead.ownerMembership?.user;
    const dto: Record<string, unknown> = {
      id: lead.id,
      studioId: lead.studioId,
      branchId: lead.branchId,
      fullName: lead.fullName,
      phone: lead.phone,
      email: lead.email,
      source: lead.source,
      sourceDetail: lead.sourceDetail,
      interestServiceTypeId: lead.interestServiceTypeId,
      interestServiceTypeName: lead.interestServiceType?.name ?? null,
      stage: lead.stage,
      lostReason: lead.lostReason,
      ownerMembershipId: lead.ownerMembershipId,
      ownerName: owner ? `${owner.firstName} ${owner.lastName}`.trim() : null,
      nextFollowUpAt: lead.nextFollowUpAt,
      convertedMembershipId: lead.convertedMembershipId,
      utmSource: lead.utmSource,
      utmMedium: lead.utmMedium,
      utmCampaign: lead.utmCampaign,
      notes: lead.notes,
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt,
    };
    if (includeActivities) {
      dto.activities = (lead.activities ?? []).map((a: any) => ({
        id: a.id,
        type: a.type,
        body: a.body,
        actorName: a.actorMembership?.user ? `${a.actorMembership.user.firstName} ${a.actorMembership.user.lastName}`.trim() : null,
        createdAt: a.createdAt,
      }));
    }
    return dto;
  }
}

/** Best-effort split of a free-text full name into first/last for the member profile. */
export function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

/** Open leads hold the per-studio phone uniqueness (see Lead.openPhone). */
function isOpenStage(stage: string): boolean {
  return stage !== LeadStage.WON && stage !== LeadStage.LOST;
}
