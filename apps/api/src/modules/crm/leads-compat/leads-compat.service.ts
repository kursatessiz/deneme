import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@platform/database';
import { LeadSource, LeadStage, canTransitionLeadStage, contactDisplayName, countryOfPhone, splitContactName } from '@platform/shared';
import type {
  AddLeadActivityInput,
  AssignLeadOwnerInput,
  BookLeadTrialInput,
  ChangeLeadStageInput,
  ConvertLeadInput,
  CreateLeadInput,
  LeadActivityDTO,
  LeadDTO,
  LeadDetailDTO,
  LeadListQuery,
  LeadListResponseDTO,
  PublicLeadFormInput,
  UpdateLeadInput,
} from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { MembersService } from '../../members/members.service';
import { SchedulesService } from '../../schedules/schedules.service';
import type { TenantContext } from '../../auth/tenant-context';
import { assertBranchAccess, branchScope } from '../../branches/branch-access';
import { ContactsService, searchFilter, canSeeMemberContact } from '../contacts/contacts.service';
import { PipelineService } from '../pipeline/pipeline.service';
import { ConversionService } from '../conversions/conversion.service';
import { AttributionService } from '../attribution/attribution.service';
import { CrmHooksService } from '../hooks/crm-hooks.service';
import { WebhooksService } from '../../webhooks/webhooks.service';
import { ConsentConfirmationService } from '../../notifications/consent/consent-confirmation.service';
import { apiError } from '../../../common/api-error';
import { requestT } from '../../../common/server-i18n';
import { activityBodyFor, activityFields, activityText } from '../activity-text';

const LEAD_INCLUDE = {
  pipelineStage: true,
  ownerMembership: { include: { user: true } },
  interestServiceType: true,
} satisfies Prisma.ContactInclude;

type LeadContact = Prisma.ContactGetPayload<{ include: typeof LEAD_INCLUDE }>;

const LEAD_STAGE_KEYS = new Set<string>(Object.values(LeadStage));

/**
 * @deprecated Compatibility layer for the W11 /leads endpoints (G1b). The
 * lead pipeline now lives on Contact: a "lead" is any contact on a
 * pipeline stage, its stage is the PipelineStage key (the system keys equal
 * the old LeadStage values) and its source is Contact.sourceChannel. The
 * request/response shapes and permissions (leads.view / leads.manage) are
 * unchanged so the current web /adaylar and mobile potansiyel-uyeler
 * screens keep working. Removed together with the leads tables in the
 * contract release; new code uses /crm (docs/CRM_VE_ATIF.md).
 */
type LeadWebhookContact = { id: string; firstName: string; lastName: string; phone: string | null; email: string | null };

@Injectable()
export class LeadsCompatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
    private readonly pipeline: PipelineService,
    private readonly conversions: ConversionService,
    private readonly attribution: AttributionService,
    private readonly hooks: CrmHooksService,
    private readonly members: MembersService,
    private readonly schedules: SchedulesService,
    @Optional() private readonly webhooks?: WebhooksService,
    @Optional() private readonly consentConfirmations?: ConsentConfirmationService,
  ) {}

  async findAll(tenant: TenantContext, query: LeadListQuery): Promise<LeadListResponseDTO> {
    const and: Prisma.ContactWhereInput[] = [branchScope(tenant, query.branchId)];
    if (query.search) and.push(searchFilter(query.search, canSeeMemberContact(tenant)));
    if (query.overdue) and.push({ nextFollowUpAt: { lt: new Date() }, pipelineStage: { kind: 'OPEN' } });
    const where: Prisma.ContactWhereInput = {
      studioId: tenant.studioId,
      mergedIntoId: null,
      pipelineStageId: { not: null },
      ...(query.stage ? { pipelineStage: { key: query.stage } } : {}),
      ...(query.source ? { sourceChannel: query.source } : {}),
      ...(query.ownerMembershipId ? { ownerMembershipId: query.ownerMembershipId } : {}),
      AND: and,
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.contact.count({ where }),
      this.prisma.contact.findMany({
        where,
        include: LEAD_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    return { items: items.map(toLeadDto), total, page: query.page, limit: query.limit };
  }

  async findById(tenant: TenantContext, leadId: string): Promise<LeadDetailDTO> {
    const contact = await this.prisma.contact.findFirst({
      where: { id: leadId, studioId: tenant.studioId, mergedIntoId: null },
      include: {
        ...LEAD_INCLUDE,
        activities: { include: { actorMembership: { include: { user: true } } }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!contact) throw new NotFoundException(apiError('apiErrors.crm.leadNotFound'));
    assertBranchAccess(tenant, contact.branchId);
    const activities: LeadActivityDTO[] = contact.activities.map((a) => ({
      id: a.id,
      type: a.type,
      body: activityBodyFor(a, requestT()),
      actorName: a.actorMembership?.user ? contactDisplayName(a.actorMembership.user) : null,
      createdAt: a.createdAt.toISOString(),
    }));
    return { ...toLeadDto(contact), activities };
  }

  async create(tenant: TenantContext, dto: CreateLeadInput) {
    const studioId = tenant.studioId;
    if (dto.branchId) assertBranchAccess(tenant, dto.branchId);
    if (dto.ownerMembershipId) await this.contacts.assertStaffMembership(studioId, dto.ownerMembershipId);

    const existing = await this.prisma.contact.findFirst({
      where: { studioId, phone: dto.phone, mergedIntoId: null },
      include: { pipelineStage: true },
    });
    if (existing) {
      // Same rule as the old one-open-lead-per-phone: fold into an activity;
      // a contact outside the pipeline (or lost) re-enters it as NEW.
      if (!existing.pipelineStage || existing.pipelineStage.kind === 'LOST') {
        await this.contacts.moveToStage(existing, 'NEW', {
          actorMembershipId: tenant.membershipId,
          activity: activityText('apiTexts.crm.reenteredAsLead'),
        });
      }
      const reapplied = activityFields(activityText('apiTexts.crm.reapplied', { detail: dto.notes ?? dto.sourceDetail ?? dto.source }));
      const activity = await this.prisma.contactActivity.create({
        data: {
          studioId,
          contactId: existing.id,
          type: 'NOTE',
          body: reapplied.body,
          metadata: { i18n: reapplied.i18n },
          actorMembershipId: tenant.membershipId,
        },
      });
      return { lead: await this.leadDto(studioId, existing.id), activity: toActivityRow(activity), deduplicated: true };
    }

    const { firstName, lastName } = splitContactName(dto.fullName);
    const { contact } = await this.contacts.resolveOrCreate(studioId, {
      firstName,
      lastName,
      phone: dto.phone,
      email: dto.email || null,
      lifecycleStage: 'LEAD',
      pipelineStageKey: LeadStage.NEW,
      ownerMembershipId: dto.ownerMembershipId ?? null,
      branchId: dto.branchId ?? null,
      sourceChannel: dto.source,
      sourceDetail: dto.sourceDetail ?? null,
      interestServiceTypeId: dto.interestServiceTypeId ?? null,
      nextFollowUpAt: dto.nextFollowUpAt ? new Date(dto.nextFollowUpAt) : null,
      notes: dto.notes ?? null,
      utm: { source: dto.utmSource ?? null, medium: dto.utmMedium ?? null, campaign: dto.utmCampaign ?? null },
    });
    await this.recordLead(studioId, contact.id);
    await this.emitLeadCreated(studioId, contact, dto.source);
    return { lead: await this.leadDto(studioId, contact.id), deduplicated: false };
  }

  /**
   * Public web form (POST /public/studios/:slug/leads). Always resolves
   * normally so the controller answers a flat 202 whatever happens.
   */
  async submitPublicForm(slug: string, dto: PublicLeadFormInput, visitorId: string | null, edgeCountry: string | null = null): Promise<void> {
    // Honeypot: a real visitor never fills this hidden field.
    if (dto.website) return;

    const studio = await this.prisma.studio.findFirst({ where: { slug, isActive: true }, select: { id: true } });
    if (!studio) return;
    const studioId = studio.id;

    const existing = await this.prisma.contact.findFirst({
      where: { studioId, phone: dto.phone, mergedIntoId: null },
      include: { pipelineStage: true },
    });
    if (existing && existing.pipelineStage && existing.pipelineStage.kind !== 'LOST') {
      const reapplied = activityFields(
        dto.interest ? activityText('apiTexts.crm.webFormReappliedWithInterest', { interest: dto.interest }) : activityText('apiTexts.crm.webFormReapplied'),
      );
      await this.prisma.contactActivity.create({
        data: { studioId, contactId: existing.id, type: 'FORM', body: reapplied.body, metadata: { i18n: reapplied.i18n } },
      });
      await this.attribution.identify(studioId, visitorId, existing.id);
      await this.recordMarketingConsent(studioId, existing.id, dto, edgeCountry);
      return;
    }

    let contactId: string;
    let leadContact: LeadWebhookContact;
    if (existing) {
      await this.contacts.moveToStage(existing, 'NEW', { activity: activityText('apiTexts.crm.webFormReentered') });
      contactId = existing.id;
      leadContact = existing;
    } else {
      const { firstName, lastName } = splitContactName(dto.fullName);
      const { contact } = await this.contacts.resolveOrCreate(studioId, {
        firstName,
        lastName,
        phone: dto.phone,
        email: dto.email || null,
        lifecycleStage: 'LEAD',
        pipelineStageKey: LeadStage.NEW,
        sourceChannel: dto.referralCode ? LeadSource.REFERRAL : LeadSource.WEB_FORM,
        sourceDetail: dto.interest || null,
        referralCode: dto.referralCode || null,
      });
      contactId = contact.id;
      leadContact = contact;
    }
    const consentActivity = activityFields(activityText('apiTexts.crm.webFormConsent'));
    await this.prisma.contactActivity.create({
      data: { studioId, contactId, type: 'FORM', body: consentActivity.body, metadata: { i18n: consentActivity.i18n } },
    });
    await this.attribution.identify(studioId, visitorId, contactId);
    await this.recordMarketingConsent(studioId, contactId, dto, edgeCountry);
    await this.recordLead(studioId, contactId);
    await this.emitLeadCreated(studioId, leadContact, dto.referralCode ? LeadSource.REFERRAL : LeadSource.WEB_FORM);
  }

  /**
   * M3e: the form's separate marketing consent box. Recorded as CONSENT on
   * e-mail (when given) and SMS; in a double opt-in region (by the
   * contact's country, else the edge country of this request, else the
   * phone's) it waits for the confirmation e-mail's link.
   */
  private async recordMarketingConsent(studioId: string, contactId: string, dto: PublicLeadFormInput, edgeCountry: string | null): Promise<void> {
    if (!dto.marketingConsent || !this.consentConfirmations) return;
    const contact = await this.prisma.contact.findFirst({ where: { id: contactId, studioId }, select: { countryCode: true, email: true, locale: true } });
    if (!contact) return;
    await this.consentConfirmations.afterFormConsent(studioId, contactId, {
      channels: contact.email ? ['EMAIL', 'SMS'] : ['SMS'],
      formVersion: dto.formVersion ?? null,
      countryCode: contact.countryCode ?? edgeCountry ?? countryOfPhone(dto.phone),
      locale: dto.locale ?? contact.locale ?? null,
    });
  }

  /** Automation hook (G3c-3): a new pipeline entry from a form or from staff. The outbox never throws. */
  private async emitLeadCreated(studioId: string, contact: LeadWebhookContact, source: string): Promise<void> {
    await this.webhooks?.emit(studioId, 'lead.created', {
      contactId: contact.id,
      fullName: contactDisplayName(contact),
      phone: contact.phone,
      email: contact.email,
      source,
    });
  }

  async update(tenant: TenantContext, leadId: string, dto: UpdateLeadInput): Promise<LeadDTO> {
    const studioId = tenant.studioId;
    const contact = await this.contacts.getOwn(tenant, leadId);
    if (dto.branchId !== undefined && dto.branchId !== null) assertBranchAccess(tenant, dto.branchId);
    if (dto.ownerMembershipId) await this.contacts.assertStaffMembership(studioId, dto.ownerMembershipId);
    const name = dto.fullName !== undefined ? splitContactName(dto.fullName) : null;
    try {
      await this.prisma.contact.update({
        where: { id: contact.id },
        data: {
          ...(dto.branchId !== undefined ? { branchId: dto.branchId } : {}),
          ...(name ? { firstName: name.firstName, lastName: name.lastName } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
          ...(dto.email !== undefined ? { email: dto.email || null } : {}),
          ...(dto.source !== undefined ? { sourceChannel: dto.source } : {}),
          ...(dto.sourceDetail !== undefined ? { sourceDetail: dto.sourceDetail } : {}),
          ...(dto.interestServiceTypeId !== undefined ? { interestServiceTypeId: dto.interestServiceTypeId } : {}),
          ...(dto.ownerMembershipId !== undefined ? { ownerMembershipId: dto.ownerMembershipId } : {}),
          ...(dto.nextFollowUpAt !== undefined
            ? { nextFollowUpAt: dto.nextFollowUpAt ? new Date(dto.nextFollowUpAt) : null }
            : {}),
          ...(dto.utmSource !== undefined ? { firstSource: dto.utmSource } : {}),
          ...(dto.utmMedium !== undefined ? { firstMedium: dto.utmMedium } : {}),
          ...(dto.utmCampaign !== undefined ? { firstCampaignName: dto.utmCampaign } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(apiError('apiErrors.crm.contactPhoneNumberEmailAlreadyExists'));
      }
      throw err;
    }
    return this.leadDto(studioId, contact.id);
  }

  async changeStage(tenant: TenantContext, leadId: string, dto: ChangeLeadStageInput): Promise<LeadDTO> {
    const contact = await this.contacts.getOwn(tenant, leadId);
    const current = contact.pipelineStageId
      ? await this.prisma.pipelineStage.findUnique({ where: { id: contact.pipelineStageId } })
      : null;
    const fromKey = current?.key ?? LeadStage.NEW;
    // WON/LOST stages are terminal; legacy keys keep the old forward-only
    // rules; a tenant-defined open stage may move to any legacy stage.
    let allowed: boolean;
    if (current && current.kind !== 'OPEN') allowed = false;
    else if (LEAD_STAGE_KEYS.has(fromKey)) allowed = canTransitionLeadStage(fromKey as LeadStage, dto.stage);
    else allowed = true;
    if (!allowed) {
      throw new BadRequestException(apiError('apiErrors.crm.invalidStageTransition', { from: fromKey, to: dto.stage }));
    }
    await this.contacts.moveToStage(contact, dto.stage, {
      lostReason: dto.stage === LeadStage.LOST ? dto.lostReason : null,
      actorMembershipId: tenant.membershipId,
      activity: dto.lostReason
        ? activityText('apiTexts.crm.stageChangedWithReason', { from: fromKey, to: dto.stage, reason: dto.lostReason })
        : activityText('apiTexts.crm.stageChanged', { from: fromKey, to: dto.stage }),
    });
    return this.leadDto(tenant.studioId, contact.id);
  }

  async assignOwner(tenant: TenantContext, leadId: string, dto: AssignLeadOwnerInput): Promise<LeadDTO> {
    const contact = await this.contacts.getOwn(tenant, leadId);
    if (dto.ownerMembershipId) await this.contacts.assertStaffMembership(tenant.studioId, dto.ownerMembershipId);
    await this.prisma.contact.update({ where: { id: contact.id }, data: { ownerMembershipId: dto.ownerMembershipId } });
    return this.leadDto(tenant.studioId, contact.id);
  }

  async addActivity(tenant: TenantContext, leadId: string, dto: AddLeadActivityInput) {
    const contact = await this.contacts.getOwn(tenant, leadId);
    const activity = await this.prisma.contactActivity.create({
      data: {
        studioId: tenant.studioId,
        contactId: contact.id,
        type: dto.type,
        body: dto.body,
        actorMembershipId: tenant.membershipId,
      },
    });
    return toActivityRow(activity);
  }

  /** Converts a lead into a member: reuses or creates the global user by phone, marks the lead WON. */
  async convert(tenant: TenantContext, leadId: string, dto: ConvertLeadInput) {
    const contact = await this.contacts.getOwn(tenant, leadId);
    const stage = contact.pipelineStageId
      ? await this.prisma.pipelineStage.findUnique({ where: { id: contact.pipelineStageId } })
      : null;
    if (stage?.kind === 'WON') throw new BadRequestException(apiError('apiErrors.crm.leadAlreadyConvertedMembership'));
    if (stage?.kind === 'LOST') throw new BadRequestException(apiError('apiErrors.crm.lostLeadCannotConvertedMembership'));
    if (!contact.phone) throw new BadRequestException(apiError('apiErrors.crm.contactWithoutPhoneNumberCannotConverted'));

    const member = await this.members.createMember(tenant, {
      studioId: tenant.studioId,
      firstName: contact.firstName,
      lastName: contact.lastName || contact.firstName,
      phone: contact.phone,
      email: contact.email ?? '',
      birthDate: dto.birthDate,
      emergencyContactName: dto.emergencyContactName,
      emergencyContactPhone: dto.emergencyContactPhone,
      notes: dto.notes ?? contact.notes ?? undefined,
      referralCode: contact.referralCode ?? undefined,
    });
    const membershipId = member.membershipId as string;

    await this.linkMembership(contact.id, membershipId);
    const fresh = await this.prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    await this.contacts.moveToStage(fresh, LeadStage.WON, {
      actorMembershipId: tenant.membershipId,
      activity: activityText('apiTexts.crm.convertedToMember', { from: stage?.key ?? LeadStage.NEW }),
    });
    return { lead: await this.leadDto(tenant.studioId, contact.id), member };
  }

  /** Creates the member (as convert() does) and books a trial session, moving the lead to TRIAL_BOOKED. */
  async bookTrial(tenant: TenantContext, leadId: string, dto: BookLeadTrialInput) {
    const contact = await this.contacts.getOwn(tenant, leadId);
    const stage = contact.pipelineStageId
      ? await this.prisma.pipelineStage.findUnique({ where: { id: contact.pipelineStageId } })
      : null;
    if (stage && stage.kind !== 'OPEN') {
      throw new BadRequestException(apiError('apiErrors.crm.trialSessionCannotArrangedLeadStage'));
    }
    if (!contact.phone) throw new BadRequestException(apiError('apiErrors.crm.trialSessionCannotArrangedContactWithout'));

    const member = await this.members.createMember(tenant, {
      studioId: tenant.studioId,
      firstName: contact.firstName,
      lastName: contact.lastName || contact.firstName,
      phone: contact.phone,
      email: contact.email ?? '',
      notes: contact.notes ?? undefined,
      referralCode: contact.referralCode ?? undefined,
    });

    // A trial session for a brand-new lead has no package to charge by design.
    const booking = await this.schedules.bookSession(tenant, {
      studioId: tenant.studioId,
      scheduleId: dto.scheduleId,
      memberId: member.id as string,
      resourceIds: [],
    }, null, { freeOfCharge: true });

    await this.linkMembership(contact.id, member.membershipId as string);
    const fresh = await this.prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    await this.contacts.moveToStage(fresh, LeadStage.TRIAL_BOOKED, {
      actorMembershipId: tenant.membershipId,
      activity: activityText('apiTexts.crm.trialPlanned'),
    });
    await this.hooks.onTrialBooked(tenant.studioId, contact.id, booking.id);
    return { lead: await this.leadDto(tenant.studioId, contact.id), member, booking };
  }

  /** The member hook normally links by phone already; this covers a lead whose phone changed meanwhile. */
  private async linkMembership(contactId: string, membershipId: string): Promise<void> {
    const holder = await this.prisma.contact.findFirst({ where: { membershipId }, select: { id: true } });
    if (holder && holder.id !== contactId) return;
    await this.prisma.contact.update({ where: { id: contactId }, data: { membershipId } });
  }

  private async recordLead(studioId: string, contactId: string): Promise<void> {
    await this.conversions.recordSafely({ studioId, type: 'lead', contactId, source: { kind: 'lead_contact', id: contactId } });
  }

  private async leadDto(studioId: string, contactId: string): Promise<LeadDTO> {
    const contact = await this.prisma.contact.findFirstOrThrow({ where: { id: contactId, studioId }, include: LEAD_INCLUDE });
    return toLeadDto(contact);
  }
}

function toLeadDto(c: LeadContact): LeadDTO {
  const owner = c.ownerMembership?.user;
  return {
    id: c.id,
    studioId: c.studioId,
    branchId: c.branchId,
    fullName: contactDisplayName(c),
    phone: c.phone ?? '',
    email: c.email,
    source: c.sourceChannel ?? LeadSource.OTHER,
    sourceDetail: c.sourceDetail,
    interestServiceTypeId: c.interestServiceTypeId,
    interestServiceTypeName: c.interestServiceType?.name ?? null,
    stage: c.pipelineStage?.key ?? LeadStage.NEW,
    lostReason: c.lostReason,
    ownerMembershipId: c.ownerMembershipId,
    ownerName: owner ? contactDisplayName(owner) : null,
    nextFollowUpAt: c.nextFollowUpAt?.toISOString() ?? null,
    convertedMembershipId: c.pipelineStage?.kind === 'WON' ? c.membershipId : null,
    utmSource: c.firstSource,
    utmMedium: c.firstMedium,
    utmCampaign: c.firstCampaignName,
    notes: c.notes,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

function toActivityRow(a: {
  id: string;
  contactId: string;
  studioId: string;
  type: string;
  body: string;
  metadata?: unknown;
  actorMembershipId: string | null;
  createdAt: Date;
}) {
  return {
    id: a.id,
    leadId: a.contactId,
    contactId: a.contactId,
    studioId: a.studioId,
    type: a.type,
    body: activityBodyFor({ body: a.body, metadata: a.metadata ?? null }, requestT()),
    actorMembershipId: a.actorMembershipId,
    createdAt: a.createdAt.toISOString(),
  };
}
