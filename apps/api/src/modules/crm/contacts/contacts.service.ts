import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@platform/database';
import type { Contact, ContactLifecycleStage } from '@platform/database';
import {
  contactDisplayName,
  normalizeTag,
  validateCustomFieldValue,
} from '@platform/shared';
import type {
  AddContactActivityInput,
  ContactCustomFields,
  ContactDTO,
  ContactExportQuery,
  ContactListQuery,
  ContactListResponseDTO,
  ContactTagsInput,
  CreateContactInput,
  MergeContactsInput,
  UpdateContactInput,
} from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { TenantContext } from '../../auth/tenant-context';
import { assertBranchAccess, branchScope } from '../../branches/branch-access';
import { PipelineService } from '../pipeline/pipeline.service';
import { AttributionService } from '../attribution/attribution.service';
import { furthestLifecycle, lifecycleEventForStage, nextLifecycle } from '../lifecycle';
import type { LifecycleEvent } from '../lifecycle';
import { toCsv } from '../../../common/csv';
import { GrowthEventsService } from '../hooks/growth-events.service';
import { PlatformEventsService } from '../../webhooks/platform-events.service';

type Db = PrismaService | Prisma.TransactionClient;

export const CONTACT_DTO_INCLUDE = {
  pipelineStage: true,
  ownerMembership: { include: { user: true } },
} satisfies Prisma.ContactInclude;

export type ContactWithRelations = Prisma.ContactGetPayload<{ include: typeof CONTACT_DTO_INCLUDE }>;

/** Everything a form, a lead wrapper or a membership hook knows about a person. */
export interface ResolveContactInput {
  firstName: string;
  lastName?: string;
  phone?: string | null;
  email?: string | null;
  locale?: string | null;
  countryCode?: string | null;
  lifecycleStage?: ContactLifecycleStage;
  pipelineStageKey?: string | null;
  ownerMembershipId?: string | null;
  branchId?: string | null;
  sourceChannel?: string | null;
  sourceDetail?: string | null;
  interestServiceTypeId?: string | null;
  nextFollowUpAt?: Date | null;
  referralCode?: string | null;
  notes?: string | null;
  utm?: { source?: string | null; medium?: string | null; campaign?: string | null };
  isTest?: boolean;
  tags?: string[];
  customFields?: ContactCustomFields;
}

export interface ResolveContactResult {
  contact: Contact;
  created: boolean;
}

const MAX_EXPORT_ROWS = 50_000;

/**
 * Contacts: one row per known person per tenant (docs/CRM_VE_ATIF.md).
 * Every query is scoped by studioId and hides merged rows.
 */
@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pipeline: PipelineService,
    private readonly attribution: AttributionService,
    @Optional() private readonly events?: GrowthEventsService,
    @Optional() private readonly platformEvents?: PlatformEventsService,
  ) {}

  // -------------------------------------------------------------------------
  // Identity resolution (forms, lead wrappers, membership hooks)
  // -------------------------------------------------------------------------

  /**
   * Finds the tenant's contact for this phone, else for this email, else
   * creates one. A phone match fills a missing email; an email match
   * without a phone gets the phone. When the email already belongs to a
   * contact with a different phone (a shared family address, typically) a
   * new contact is created without the email instead of failing.
   */
  async resolveOrCreate(studioId: string, input: ResolveContactInput, db: Db = this.prisma): Promise<ResolveContactResult> {
    const phone = input.phone || null;
    const email = input.email?.trim() || null;

    const found = await this.findExisting(studioId, phone, email, db);
    if (found) {
      await this.fillBlanks(found, phone, email, db);
      return { contact: await db.contact.findUniqueOrThrow({ where: { id: found.id } }), created: false };
    }

    const emailFree = email ? !(await this.emailTaken(studioId, email, db)) : false;
    const stage = input.pipelineStageKey ? await this.pipeline.getByKey(studioId, input.pipelineStageKey) : null;
    try {
      const contact = await db.contact.create({
        data: {
          studioId,
          firstName: input.firstName.slice(0, 60),
          lastName: (input.lastName ?? '').slice(0, 60),
          phone,
          email: emailFree ? email : null,
          locale: input.locale ?? null,
          countryCode: input.countryCode ?? null,
          lifecycleStage: input.lifecycleStage ?? 'LEAD',
          pipelineStageId: stage?.id ?? null,
          ownerMembershipId: input.ownerMembershipId ?? null,
          branchId: input.branchId ?? null,
          sourceChannel: input.sourceChannel ?? null,
          sourceDetail: input.sourceDetail ?? null,
          interestServiceTypeId: input.interestServiceTypeId ?? null,
          nextFollowUpAt: input.nextFollowUpAt ?? null,
          referralCode: input.referralCode ?? null,
          notes: input.notes ?? null,
          isTest: input.isTest ?? false,
          tags: input.tags ?? [],
          customFields: (input.customFields ?? {}) as Prisma.InputJsonValue,
          firstSource: input.utm?.source ?? null,
          firstMedium: input.utm?.medium ?? null,
          firstCampaignName: input.utm?.campaign ?? null,
          lastSource: input.utm?.source ?? null,
          lastMedium: input.utm?.medium ?? null,
          lastCampaignName: input.utm?.campaign ?? null,
        },
      });
      return { contact, created: true };
    } catch (err) {
      // A concurrent request created the same person: use that row.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.findExisting(studioId, phone, email, db);
        if (winner) return { contact: winner, created: false };
      }
      throw err;
    }
  }

  private async findExisting(studioId: string, phone: string | null, email: string | null, db: Db): Promise<Contact | null> {
    if (phone) {
      const byPhone = await db.contact.findFirst({ where: { studioId, phone, mergedIntoId: null } });
      if (byPhone) return byPhone;
    }
    if (email) {
      const byEmail = await db.contact.findFirst({
        where: { studioId, email: { equals: email, mode: 'insensitive' }, mergedIntoId: null },
      });
      if (byEmail && (!phone || !byEmail.phone)) return byEmail;
    }
    return null;
  }

  private async fillBlanks(contact: Contact, phone: string | null, email: string | null, db: Db): Promise<void> {
    const data: Prisma.ContactUncheckedUpdateInput = {};
    if (!contact.phone && phone) data.phone = phone;
    if (!contact.email && email && !(await this.emailTaken(contact.studioId, email, db))) data.email = email;
    if (Object.keys(data).length === 0) return;
    try {
      await db.contact.update({ where: { id: contact.id }, data });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    }
  }

  private async emailTaken(studioId: string, email: string, db: Db): Promise<boolean> {
    const hit = await db.contact.findFirst({
      where: { studioId, email: { equals: email, mode: 'insensitive' }, mergedIntoId: null },
      select: { id: true },
    });
    return Boolean(hit);
  }

  /** Applies a lifecycle event; records a LIFECYCLE activity when the stage changes. */
  async applyLifecycle(
    contact: Pick<Contact, 'id' | 'studioId' | 'lifecycleStage'>,
    event: LifecycleEvent,
    opts: { force?: ContactLifecycleStage; actorMembershipId?: string | null } = {},
    db: Db = this.prisma,
  ): Promise<ContactLifecycleStage> {
    const next = opts.force ?? nextLifecycle(contact.lifecycleStage, event);
    if (next === contact.lifecycleStage) return next;
    await db.contact.update({ where: { id: contact.id }, data: { lifecycleStage: next } });
    await db.contactActivity.create({
      data: {
        studioId: contact.studioId,
        contactId: contact.id,
        type: 'LIFECYCLE',
        body: `${contact.lifecycleStage} -> ${next}`,
        actorMembershipId: opts.actorMembershipId ?? null,
        metadata: { from: contact.lifecycleStage, to: next, event },
      },
    });
    await this.platformEvents?.emitForStudio(contact.studioId, 'contact.lifecycle_changed', {
      contactId: contact.id,
      from: contact.lifecycleStage,
      to: next,
      event,
    });
    return next;
  }

  /**
   * Moves a contact onto a pipeline stage: sets the lost reason for LOST
   * stages, derives the lifecycle and logs a STAGE_CHANGE activity.
   */
  async moveToStage(
    contact: Pick<Contact, 'id' | 'studioId' | 'lifecycleStage' | 'pipelineStageId'>,
    stageKey: string,
    opts: { lostReason?: string | null; actorMembershipId?: string | null; activityBody?: string } = {},
  ): Promise<void> {
    const target = await this.pipeline.getByKey(contact.studioId, stageKey);
    const current = contact.pipelineStageId
      ? await this.prisma.pipelineStage.findUnique({ where: { id: contact.pipelineStageId } })
      : null;
    const lifecycleEvent = lifecycleEventForStage(target.key, target.kind);
    const lifecycle = nextLifecycle(contact.lifecycleStage, lifecycleEvent);
    await this.prisma.$transaction(async (tx) => {
      await tx.contact.update({
        where: { id: contact.id },
        data: {
          pipelineStageId: target.id,
          lostReason: target.kind === 'LOST' ? opts.lostReason ?? null : null,
          lifecycleStage: lifecycle,
        },
      });
      await tx.contactActivity.create({
        data: {
          studioId: contact.studioId,
          contactId: contact.id,
          type: 'STAGE_CHANGE',
          body:
            opts.activityBody ??
            `Aşama değişti: ${current?.key ?? '-'} -> ${target.key}${opts.lostReason ? ` (${opts.lostReason})` : ''}`,
          actorMembershipId: opts.actorMembershipId ?? null,
          metadata: { from: current?.key ?? null, to: target.key },
        },
      });
    });
    if (lifecycle !== contact.lifecycleStage) {
      await this.platformEvents?.emitForStudio(contact.studioId, 'contact.lifecycle_changed', {
        contactId: contact.id,
        from: contact.lifecycleStage,
        to: lifecycle,
        event: lifecycleEvent,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Staff API
  // -------------------------------------------------------------------------

  async list(tenant: TenantContext, query: ContactListQuery): Promise<ContactListResponseDTO> {
    const where = this.buildWhere(tenant, query);
    const [total, items] = await this.prisma.$transaction([
      this.prisma.contact.count({ where }),
      this.prisma.contact.findMany({
        where,
        include: CONTACT_DTO_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    return { items: items.map((c) => toContactDto(c, canSeeMemberContact(tenant))), total, page: query.page, limit: query.limit };
  }

  async detail(tenant: TenantContext, contactId: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, studioId: tenant.studioId, mergedIntoId: null },
      include: {
        ...CONTACT_DTO_INCLUDE,
        activities: { include: { actorMembership: { include: { user: true } } }, orderBy: { createdAt: 'desc' }, take: 200 },
        tasks: { orderBy: [{ status: 'asc' }, { dueAt: 'asc' }], take: 100 },
        touchpoints: { orderBy: { occurredAt: 'desc' }, take: 50 },
        conversions: { orderBy: { occurredAt: 'desc' }, take: 100 },
      },
    });
    if (!contact) throw new NotFoundException('Kişi bulunamadı');
    assertBranchAccess(tenant, contact.branchId);
    return {
      ...toContactDto(contact, canSeeMemberContact(tenant)),
      activities: contact.activities.map((a) => ({
        id: a.id,
        type: a.type,
        body: a.body,
        actorName: a.actorMembership?.user ? contactDisplayName(a.actorMembership.user) : null,
        createdAt: a.createdAt.toISOString(),
      })),
      tasks: contact.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        notes: t.notes,
        dueAt: t.dueAt?.toISOString() ?? null,
        status: t.status,
        assigneeMembershipId: t.assigneeMembershipId,
        completedAt: t.completedAt?.toISOString() ?? null,
        createdAt: t.createdAt.toISOString(),
      })),
      touchpoints: contact.touchpoints.map((t) => ({
        id: t.id,
        occurredAt: t.occurredAt.toISOString(),
        landingHost: t.landingHost,
        landingPath: t.landingPath,
        referrerHost: t.referrerHost,
        utmSource: t.utmSource,
        utmMedium: t.utmMedium,
        utmCampaign: t.utmCampaign,
        adPlatform: t.adPlatform,
        pwCid: t.pwCid,
        pwAsid: t.pwAsid,
        pwAdid: t.pwAdid,
        isPaidUntagged: t.isPaidUntagged,
      })),
      conversions: contact.conversions.map((c) => ({
        id: c.id,
        eventId: c.eventId,
        type: c.type,
        occurredAt: c.occurredAt.toISOString(),
        valueAmount: c.valueAmount?.toFixed(2) ?? null,
        currency: c.currency,
        isTest: c.isTest,
      })),
    };
  }

  async create(tenant: TenantContext, dto: CreateContactInput): Promise<ContactDTO> {
    const studioId = tenant.studioId;
    if (dto.branchId) assertBranchAccess(tenant, dto.branchId);
    if (dto.ownerMembershipId) await this.assertStaffMembership(studioId, dto.ownerMembershipId);
    const customFields = dto.customFields ? await this.validateCustomFields(studioId, dto.customFields, {}) : {};
    if (dto.phone && (await this.prisma.contact.findFirst({ where: { studioId, phone: dto.phone, mergedIntoId: null } }))) {
      throw new ConflictException('Bu telefon numarasıyla bir kişi zaten var');
    }
    if (dto.email && (await this.emailTaken(studioId, dto.email, this.prisma))) {
      throw new ConflictException('Bu e-posta adresiyle bir kişi zaten var');
    }
    const { contact } = await this.resolveOrCreate(studioId, {
      firstName: dto.firstName,
      lastName: dto.lastName,
      phone: dto.phone,
      email: dto.email || null,
      locale: dto.locale,
      countryCode: dto.countryCode,
      lifecycleStage: dto.lifecycleStage,
      pipelineStageKey: dto.pipelineStageKey,
      ownerMembershipId: dto.ownerMembershipId,
      branchId: dto.branchId,
      sourceChannel: dto.sourceChannel,
      sourceDetail: dto.sourceDetail,
      notes: dto.notes,
      isTest: dto.isTest,
      tags: dedupeTags(dto.tags ?? []),
      customFields,
    });
    if (dto.timezone || dto.isBusiness !== undefined) {
      await this.prisma.contact.update({
        where: { id: contact.id },
        data: { ...(dto.timezone ? { timezone: dto.timezone } : {}), ...(dto.isBusiness !== undefined ? { isBusiness: dto.isBusiness } : {}) },
      });
    }
    return this.getDto(studioId, contact.id, canSeeMemberContact(tenant));
  }

  async update(tenant: TenantContext, contactId: string, dto: UpdateContactInput): Promise<ContactDTO> {
    const contact = await this.getOwn(tenant, contactId);
    const studioId = tenant.studioId;
    if (dto.branchId) assertBranchAccess(tenant, dto.branchId);
    if (dto.ownerMembershipId) await this.assertStaffMembership(studioId, dto.ownerMembershipId);
    const customFields =
      dto.customFields !== undefined
        ? await this.validateCustomFields(studioId, dto.customFields, (contact.customFields ?? {}) as ContactCustomFields)
        : undefined;

    try {
      await this.prisma.contact.update({
        where: { id: contact.id },
        data: {
          ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
          ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
          ...(dto.email !== undefined ? { email: dto.email || null } : {}),
          ...(dto.locale !== undefined ? { locale: dto.locale } : {}),
          ...(dto.countryCode !== undefined ? { countryCode: dto.countryCode } : {}),
          ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
          ...(dto.ownerMembershipId !== undefined ? { ownerMembershipId: dto.ownerMembershipId } : {}),
          ...(dto.branchId !== undefined ? { branchId: dto.branchId } : {}),
          ...(dto.tags !== undefined ? { tags: dedupeTags(dto.tags) } : {}),
          ...(customFields !== undefined ? { customFields: customFields as Prisma.InputJsonValue } : {}),
          ...(dto.sourceChannel !== undefined ? { sourceChannel: dto.sourceChannel } : {}),
          ...(dto.sourceDetail !== undefined ? { sourceDetail: dto.sourceDetail } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          ...(dto.isTest !== undefined ? { isTest: dto.isTest } : {}),
          ...(dto.isBusiness !== undefined ? { isBusiness: dto.isBusiness } : {}),
          ...(dto.nextFollowUpAt !== undefined ? { nextFollowUpAt: dto.nextFollowUpAt ? new Date(dto.nextFollowUpAt) : null } : {}),
        },
      });
    } catch (err) {
      throw uniqueConflict(err);
    }

    if (dto.pipelineStageKey !== undefined) {
      if (dto.pipelineStageKey === null) {
        await this.prisma.contact.update({ where: { id: contact.id }, data: { pipelineStageId: null } });
      } else {
        const target = await this.pipeline.getByKey(studioId, dto.pipelineStageKey);
        if (target.kind === 'LOST' && !dto.lostReason) throw new BadRequestException('Kayıp nedeni giriniz');
        if (target.id !== contact.pipelineStageId) {
          await this.moveToStage(contact, target.key, { lostReason: dto.lostReason, actorMembershipId: tenant.membershipId });
        }
      }
    }
    if (dto.lifecycleStage !== undefined && dto.lifecycleStage !== contact.lifecycleStage) {
      const fresh = await this.prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
      await this.applyLifecycle(fresh, 'lead', { force: dto.lifecycleStage, actorMembershipId: tenant.membershipId });
    }
    return this.getDto(studioId, contact.id, canSeeMemberContact(tenant));
  }

  async addActivity(tenant: TenantContext, contactId: string, dto: AddContactActivityInput) {
    const contact = await this.getOwn(tenant, contactId);
    return this.prisma.contactActivity.create({
      data: { studioId: tenant.studioId, contactId: contact.id, type: dto.type, body: dto.body, actorMembershipId: tenant.membershipId },
    });
  }

  async updateTags(tenant: TenantContext, contactId: string, dto: ContactTagsInput): Promise<ContactDTO> {
    const contact = await this.getOwn(tenant, contactId);
    const remove = new Set(dto.remove);
    const tags = dedupeTags([...contact.tags.filter((t) => !remove.has(t)), ...dto.add]);
    await this.prisma.contact.update({ where: { id: contact.id }, data: { tags } });
    const before = new Set(contact.tags);
    const now = new Date();
    for (const tag of tags.filter((t) => !before.has(t))) {
      await this.events?.emit({
        studioId: tenant.studioId,
        contactId: contact.id,
        event: 'tag_added',
        ref: `tag:${tag}:${now.toISOString()}`,
        occurredAt: now,
        variables: { tag },
      });
    }
    return this.getDto(tenant.studioId, contact.id, canSeeMemberContact(tenant));
  }

  /** Distinct tags in use with how many (unmerged) contacts carry each. */
  async listTags(tenant: TenantContext): Promise<{ tag: string; count: number }[]> {
    const rows = await this.prisma.$queryRaw<{ tag: string; count: bigint }[]>`
      SELECT t.tag, count(*)::bigint AS count
      FROM "contacts" c, unnest(c."tags") AS t(tag)
      WHERE c."studio_id" = ${tenant.studioId}::uuid AND c."merged_into_id" IS NULL
      GROUP BY t.tag
      ORDER BY count DESC, t.tag ASC
      LIMIT 500`;
    return rows.map((r) => ({ tag: r.tag, count: Number(r.count) }));
  }

  /**
   * Merges `mergedId` into `survivorId` (audited). The survivor keeps its
   * own values and takes over the loser's blanks, tags, custom fields,
   * activities, tasks, visitors, touchpoints and conversions; the lifecycle
   * is the further-along of the two. The loser is kept, hidden, with
   * mergedIntoId set. Two contacts that both have a member account cannot
   * be merged: those are two different people in the membership system.
   */
  async merge(tenant: TenantContext, actorUserId: string, dto: MergeContactsInput): Promise<ContactDTO> {
    const studioId = tenant.studioId;
    const [survivor, merged] = await Promise.all([this.getOwn(tenant, dto.survivorId), this.getOwn(tenant, dto.mergedId)]);
    if (survivor.membershipId && merged.membershipId) {
      throw new ConflictException('İki kişinin de üyelik hesabı var; bu kişiler birleştirilemez');
    }

    await this.prisma.$transaction(async (tx) => {
      // Hide the loser first so its phone/email stop counting against the unique indexes.
      await tx.contact.update({ where: { id: merged.id }, data: { mergedIntoId: survivor.id, membershipId: null } });
      await tx.contact.updateMany({ where: { studioId, mergedIntoId: merged.id }, data: { mergedIntoId: survivor.id } });
      await tx.contactActivity.updateMany({ where: { studioId, contactId: merged.id }, data: { contactId: survivor.id } });
      await tx.contactTask.updateMany({ where: { studioId, contactId: merged.id }, data: { contactId: survivor.id } });
      await tx.visitor.updateMany({ where: { studioId, contactId: merged.id }, data: { contactId: survivor.id } });
      await tx.touchpoint.updateMany({ where: { studioId, contactId: merged.id }, data: { contactId: survivor.id } });
      await tx.conversionEvent.updateMany({ where: { studioId, contactId: merged.id }, data: { contactId: survivor.id } });

      const survivorFields = (survivor.customFields ?? {}) as ContactCustomFields;
      const mergedFields = (merged.customFields ?? {}) as ContactCustomFields;
      await tx.contact.update({
        where: { id: survivor.id },
        data: {
          lastName: survivor.lastName || merged.lastName,
          phone: survivor.phone ?? merged.phone,
          email: survivor.email ?? merged.email,
          locale: survivor.locale ?? merged.locale,
          countryCode: survivor.countryCode ?? merged.countryCode,
          timezone: survivor.timezone ?? merged.timezone,
          ownerMembershipId: survivor.ownerMembershipId ?? merged.ownerMembershipId,
          branchId: survivor.branchId ?? merged.branchId,
          pipelineStageId: survivor.pipelineStageId ?? merged.pipelineStageId,
          membershipId: survivor.membershipId ?? merged.membershipId,
          lifecycleStage: furthestLifecycle(survivor.lifecycleStage, merged.lifecycleStage),
          tags: dedupeTags([...survivor.tags, ...merged.tags]),
          customFields: { ...mergedFields, ...survivorFields } as Prisma.InputJsonValue,
          sourceChannel: survivor.sourceChannel ?? merged.sourceChannel,
          sourceDetail: survivor.sourceDetail ?? merged.sourceDetail,
          interestServiceTypeId: survivor.interestServiceTypeId ?? merged.interestServiceTypeId,
          nextFollowUpAt: survivor.nextFollowUpAt ?? merged.nextFollowUpAt,
          referralCode: survivor.referralCode ?? merged.referralCode,
          notes: [survivor.notes, merged.notes].filter(Boolean).join('\n\n') || null,
          isTest: survivor.isTest && merged.isTest,
          ...(survivor.firstTouchpointId || survivor.firstSource
            ? {}
            : {
                firstSource: merged.firstSource,
                firstMedium: merged.firstMedium,
                firstCampaignName: merged.firstCampaignName,
                firstCampaignId: merged.firstCampaignId,
                firstAdsetId: merged.firstAdsetId,
                firstAdId: merged.firstAdId,
              }),
          ...(survivor.lastTouchpointId || survivor.lastSource
            ? {}
            : {
                lastSource: merged.lastSource,
                lastMedium: merged.lastMedium,
                lastCampaignName: merged.lastCampaignName,
                lastCampaignId: merged.lastCampaignId,
                lastAdsetId: merged.lastAdsetId,
                lastAdId: merged.lastAdId,
              }),
        },
      });

      await tx.contactActivity.create({
        data: {
          studioId,
          contactId: survivor.id,
          type: 'MERGE',
          body: `${contactDisplayName(merged)} birleştirildi`,
          actorMembershipId: tenant.membershipId,
          metadata: { mergedId: merged.id, phone: merged.phone, email: merged.email },
        },
      });
      await tx.auditLog.create({
        data: {
          studioId,
          userId: actorUserId,
          action: 'contact.merge',
          entityType: 'Contact',
          entityId: survivor.id,
          metadata: {
            survivorId: survivor.id,
            mergedId: merged.id,
            merged: { firstName: merged.firstName, lastName: merged.lastName, phone: merged.phone, email: merged.email },
          } as Prisma.InputJsonValue,
        },
      });
    });

    await this.attribution.refreshContactTouches(studioId, survivor.id);
    return this.getDto(studioId, survivor.id, canSeeMemberContact(tenant));
  }

  async exportCsv(tenant: TenantContext, query: ContactExportQuery): Promise<string> {
    const where = this.buildWhere(tenant, query);
    const contacts = await this.prisma.contact.findMany({
      where,
      include: CONTACT_DTO_INCLUDE,
      orderBy: { createdAt: 'asc' },
      take: MAX_EXPORT_ROWS,
    });
    const header = [
      'id',
      'firstName',
      'lastName',
      'phone',
      'email',
      'locale',
      'countryCode',
      'lifecycleStage',
      'pipelineStage',
      'owner',
      'tags',
      'firstSource',
      'firstCampaignId',
      'lastSource',
      'lastCampaignId',
      'sourceChannel',
      'createdAt',
    ];
    const showMemberContact = canSeeMemberContact(tenant);
    const rows = contacts.map((c) => {
      const owner = c.ownerMembership?.user;
      const hideContact = !showMemberContact && c.membershipId !== null;
      return [
        c.id,
        c.firstName,
        c.lastName,
        hideContact ? null : c.phone,
        hideContact ? null : c.email,
        c.locale,
        c.countryCode,
        c.lifecycleStage,
        c.pipelineStage?.key ?? null,
        owner ? contactDisplayName(owner) : null,
        c.tags.join('|'),
        c.firstSource,
        c.firstCampaignId,
        c.lastSource,
        c.lastCampaignId,
        c.sourceChannel,
        c.createdAt.toISOString(),
      ];
    });
    return toCsv(header, rows);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  async getDto(studioId: string, contactId: string, showMemberContact = true): Promise<ContactDTO> {
    const contact = await this.prisma.contact.findFirstOrThrow({ where: { id: contactId, studioId }, include: CONTACT_DTO_INCLUDE });
    return toContactDto(contact, showMemberContact);
  }

  async getOwn(tenant: TenantContext, contactId: string): Promise<Contact> {
    const contact = await this.prisma.contact.findFirst({ where: { id: contactId, studioId: tenant.studioId, mergedIntoId: null } });
    if (!contact) throw new NotFoundException('Kişi bulunamadı');
    assertBranchAccess(tenant, contact.branchId);
    return contact;
  }

  async assertStaffMembership(studioId: string, membershipId: string): Promise<void> {
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, studioId, status: 'ACTIVE' },
      include: { roleTemplate: true },
    });
    if (!membership || membership.roleTemplate.key === 'member') {
      throw new BadRequestException('Sorumlu personel bu işletmede aktif bir personel üyeliği olmalıdır');
    }
  }

  /** Validates values against the tenant's field definitions; null removes a value. */
  async validateCustomFields(
    studioId: string,
    input: ContactCustomFields,
    current: ContactCustomFields,
  ): Promise<ContactCustomFields> {
    const keys = Object.keys(input);
    if (keys.length === 0) return current;
    const defs = await this.prisma.contactFieldDefinition.findMany({ where: { studioId, key: { in: keys }, isArchived: false } });
    const byKey = new Map(defs.map((d) => [d.key, d]));
    const next: ContactCustomFields = { ...current };
    for (const key of keys) {
      const def = byKey.get(key);
      if (!def) throw new BadRequestException(`'${key}' adlı özel alan tanımlı değil`);
      const value = input[key];
      const error = validateCustomFieldValue(def, value);
      if (error) throw new BadRequestException(`${key}: ${error}`);
      if (value === null) delete next[key];
      else next[key] = value;
    }
    return next;
  }

  private buildWhere(tenant: TenantContext, query: ContactExportQuery): Prisma.ContactWhereInput {
    const and: Prisma.ContactWhereInput[] = [branchScope(tenant, query.branchId)];
    if (query.source) {
      and.push({
        OR: [
          { firstSource: { equals: query.source, mode: 'insensitive' } },
          { lastSource: { equals: query.source, mode: 'insensitive' } },
          { sourceChannel: { equals: query.source, mode: 'insensitive' } },
        ],
      });
    }
    if (query.search) and.push(searchFilter(query.search, canSeeMemberContact(tenant)));
    const tag = query.tag ? normalizeTag(query.tag) : null;
    return {
      studioId: tenant.studioId,
      mergedIntoId: null,
      ...(query.includeTest ? {} : { isTest: false }),
      ...(query.stage ? { pipelineStage: { key: query.stage } } : {}),
      ...(query.lifecycleStage ? { lifecycleStage: query.lifecycleStage } : {}),
      ...(query.ownerMembershipId ? { ownerMembershipId: query.ownerMembershipId } : {}),
      ...(query.tag ? { tags: { has: tag ?? query.tag } } : {}),
      AND: and,
    };
  }
}

/** Name, phone or email contains the text; "first last" also matches across both name columns. */
export function searchFilter(search: string, matchMemberContact = true): Prisma.ContactWhereInput {
  const text = search.trim();
  // Without members.contact.view, phone/email only match non-member contacts,
  // so the search cannot be used to confirm a member's number.
  const contactScope: Prisma.ContactWhereInput = matchMemberContact ? {} : { membershipId: null };
  const or: Prisma.ContactWhereInput[] = [
    { firstName: { contains: text, mode: 'insensitive' } },
    { lastName: { contains: text, mode: 'insensitive' } },
    { phone: { contains: text }, ...contactScope },
    { email: { contains: text, mode: 'insensitive' }, ...contactScope },
  ];
  const parts = text.split(/\s+/);
  if (parts.length > 1) {
    or.push({
      AND: [
        { firstName: { contains: parts.slice(0, -1).join(' '), mode: 'insensitive' } },
        { lastName: { contains: parts[parts.length - 1], mode: 'insensitive' } },
      ],
    });
  }
  return { OR: or };
}

export function dedupeTags(tags: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const tag = normalizeTag(raw);
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

/**
 * Whether the caller may see phone and email of contacts linked to a
 * membership. Members' contact details have always required
 * members.contact.view (see the churn phone-search fix); crm.view alone
 * must not widen that, so without it member contacts come back without
 * phone/email and are not matched by phone/email search.
 */
export function canSeeMemberContact(tenant: Pick<TenantContext, 'permissions'>): boolean {
  return tenant.permissions.has('members.contact.view');
}

export function toContactDto(c: ContactWithRelations, showMemberContact = true): ContactDTO {
  const owner = c.ownerMembership?.user;
  const hideContact = !showMemberContact && c.membershipId !== null;
  return {
    id: c.id,
    studioId: c.studioId,
    firstName: c.firstName,
    lastName: c.lastName,
    fullName: contactDisplayName(c),
    phone: hideContact ? null : c.phone,
    email: hideContact ? null : c.email,
    locale: c.locale,
    countryCode: c.countryCode,
    timezone: c.timezone,
    lifecycleStage: c.lifecycleStage,
    pipelineStage: c.pipelineStage
      ? { id: c.pipelineStage.id, key: c.pipelineStage.key, name: c.pipelineStage.name, kind: c.pipelineStage.kind }
      : null,
    ownerMembershipId: c.ownerMembershipId,
    ownerName: owner ? contactDisplayName(owner) : null,
    branchId: c.branchId,
    tags: c.tags,
    customFields: (c.customFields ?? {}) as ContactCustomFields,
    membershipId: c.membershipId,
    firstSource: c.firstSource,
    firstCampaignId: c.firstCampaignId,
    lastSource: c.lastSource,
    lastCampaignId: c.lastCampaignId,
    sourceChannel: c.sourceChannel,
    sourceDetail: c.sourceDetail,
    nextFollowUpAt: c.nextFollowUpAt?.toISOString() ?? null,
    notes: c.notes,
    isTest: c.isTest,
    isBusiness: c.isBusiness,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

function uniqueConflict(err: unknown): unknown {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    return new ConflictException('Bu telefon numarası veya e-posta ile bir kişi zaten var');
  }
  return err;
}
