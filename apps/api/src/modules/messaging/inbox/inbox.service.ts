import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@platform/database';
import type { Conversation, ConversationMessage } from '@platform/database';
import { BUILTIN_TEMPLATES, contactDisplayName, messagePlaceholders, whatsappWindowOpen } from '@platform/shared';
import type {
  AssignConversationInput,
  ConversationAttachmentDTO,
  ConversationChannel,
  ConversationDetailDTO,
  ConversationListQuery,
  ConversationMessageDTO,
  ConversationSummaryDTO,
  InAppMessageDTO,
  InboxReplyInput,
  MemberChatDTO,
  SavedReplyDTO,
  SavedReplyInput,
} from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { TenantContext } from '../../auth/tenant-context';
import { ContactsService, canSeeMemberContact } from '../../crm/contacts/contacts.service';
import { CrmHooksService } from '../../crm/hooks/crm-hooks.service';
import { MessagingService } from '../engine/messaging.service';
import { apiError } from '../../../common/api-error';

const CONVERSATION_INCLUDE = {
  contact: { select: { id: true, firstName: true, lastName: true, phone: true, email: true, membershipId: true } },
  assignedMembership: { select: { id: true, user: { select: { firstName: true, lastName: true } } } },
} satisfies Prisma.ConversationInclude;
type ConversationWithRelations = Prisma.ConversationGetPayload<{ include: typeof CONVERSATION_INCLUDE }>;

const MESSAGE_INCLUDE = {
  authorMembership: { select: { user: { select: { firstName: true, lastName: true } } } },
} satisfies Prisma.ConversationMessageInclude;
type MessageWithAuthor = Prisma.ConversationMessageGetPayload<{ include: typeof MESSAGE_INCLUDE }>;

function attachmentsOf(raw: Prisma.JsonValue): ConversationAttachmentDTO[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((a): ConversationAttachmentDTO[] => {
    if (!a || typeof a !== 'object' || Array.isArray(a)) return [];
    const o = a as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' ? v : null);
    return [{ kind: str(o.kind) ?? 'file', mimeType: str(o.mimeType), providerMediaId: str(o.providerMediaId), fileName: str(o.fileName) }];
  });
}

function toMessageDto(m: MessageWithAuthor | ConversationMessage): ConversationMessageDTO {
  const author = 'authorMembership' in m ? m.authorMembership?.user : undefined;
  return {
    id: m.id,
    direction: m.direction,
    body: m.body,
    status: m.status,
    authorName: author ? `${author.firstName} ${author.lastName}`.trim() : null,
    attachments: attachmentsOf(m.attachments),
    createdAt: m.createdAt.toISOString(),
  };
}

/**
 * Staff inbox and the member's in-app chat (docs/MESAJLASMA.md, "Gelen
 * kutusu"). Every query is scoped to the tenant's studioId. Contacts linked
 * to a membership show phone and email only with members.contact.view (the
 * G1b CRM rule).
 */
@Injectable()
export class InboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly contacts: ContactsService,
    private readonly crmHooks: CrmHooksService,
  ) {}

  // ---------------------------------------------------------------------------
  // Staff
  // ---------------------------------------------------------------------------

  async list(tenant: TenantContext, query: ConversationListQuery): Promise<{ items: ConversationSummaryDTO[] }> {
    const showContact = canSeeMemberContact(tenant);
    const where: Prisma.ConversationWhereInput = {
      studioId: tenant.studioId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.assigned === 'me' ? { assignedMembershipId: tenant.membershipId ?? '00000000-0000-0000-0000-000000000000' } : {}),
      ...(query.assigned === 'unassigned' ? { assignedMembershipId: null } : {}),
      ...(query.before ? { lastMessageAt: { lt: new Date(query.before) } } : {}),
    };
    if (query.search) {
      const text = query.search.trim();
      where.contact = {
        OR: [
          { firstName: { contains: text, mode: 'insensitive' } },
          { lastName: { contains: text, mode: 'insensitive' } },
          ...(showContact ? [{ phone: { contains: text } }] : [{ phone: { contains: text }, membershipId: null }]),
        ],
      };
    }
    const rows = await this.prisma.conversation.findMany({
      where,
      include: CONVERSATION_INCLUDE,
      orderBy: { lastMessageAt: 'desc' },
      take: query.take,
    });
    return { items: rows.map((c) => this.toSummary(c, showContact)) };
  }

  async detail(tenant: TenantContext, conversationId: string): Promise<ConversationDetailDTO> {
    const conversation = await this.getOwn(tenant, conversationId);
    const messages = await this.prisma.conversationMessage.findMany({
      where: { conversationId, studioId: tenant.studioId },
      include: MESSAGE_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    if (conversation.unreadCount > 0) {
      await this.prisma.conversation.update({ where: { id: conversation.id }, data: { unreadCount: 0 } });
      conversation.unreadCount = 0;
    }
    return { ...this.toSummary(conversation, canSeeMemberContact(tenant)), messages: messages.reverse().map(toMessageDto) };
  }

  async reply(tenant: TenantContext, conversationId: string, dto: InboxReplyInput): Promise<ConversationDetailDTO> {
    const conversation = await this.getOwn(tenant, conversationId);
    if (conversation.status === 'CLOSED') throw new BadRequestException(apiError('apiErrors.messaging.cannotReplyClosedConversationReopen'));

    if (conversation.channel === 'IN_APP') {
      if (!dto.body) throw new BadRequestException(apiError('apiErrors.messaging.onlyTextCanSentAppChat'));
      await this.appendOut(tenant, conversation, dto.body);
      return this.detail(tenant, conversationId);
    }

    if (conversation.channel === 'WHATSAPP' && dto.body && !whatsappWindowOpen(conversation.lastInboundAt)) {
      throw new UnprocessableEntityException(
        apiError('apiErrors.messaging.24HourWhatsappCustomerServiceWindow'),
      );
    }
    const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: tenant.studioId }, select: { name: true } });
    const result = await this.messaging.send({
      studioId: tenant.studioId,
      recipient: { contactId: conversation.contactId },
      channel: conversation.channel as ConversationChannel,
      purpose: 'TRANSACTIONAL',
      ...(dto.body
        ? { content: { text: dto.body, subject: conversation.channel === 'EMAIL' ? studio.name : null }, type: 'INBOX_REPLY' }
        : { templateKey: dto.templateKey, variables: dto.variables }),
      whatsappFreeForm: conversation.channel === 'WHATSAPP' && Boolean(dto.body),
      conversationId: conversation.id,
      authorMembershipId: tenant.membershipId,
    });
    if (!result.success && !result.notificationLogId) {
      // Nothing was recorded (no address, no approved template, ...): tell the sender why.
      throw new UnprocessableEntityException(result.reason ?? apiError('apiErrors.messaging.messageCouldNotBeSent'));
    }
    return this.detail(tenant, conversationId);
  }

  async assign(tenant: TenantContext, conversationId: string, dto: AssignConversationInput): Promise<ConversationSummaryDTO> {
    const conversation = await this.getOwn(tenant, conversationId);
    const membershipId = dto.membershipId === 'me' ? tenant.membershipId : dto.membershipId;
    if (dto.membershipId === 'me' && !membershipId) throw new BadRequestException(apiError('apiErrors.messaging.noMembershipBusiness'));
    if (membershipId) await this.contacts.assertStaffMembership(tenant.studioId, membershipId);
    const updated = await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { assignedMembershipId: membershipId ?? null },
      include: CONVERSATION_INCLUDE,
    });
    return this.toSummary(updated, canSeeMemberContact(tenant));
  }

  async setStatus(tenant: TenantContext, conversationId: string, status: 'OPEN' | 'CLOSED'): Promise<ConversationSummaryDTO> {
    const conversation = await this.getOwn(tenant, conversationId);
    try {
      const updated = await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { status, closedAt: status === 'CLOSED' ? new Date() : null },
        include: CONVERSATION_INCLUDE,
      });
      return this.toSummary(updated, canSeeMemberContact(tenant));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(apiError('apiErrors.messaging.alreadyOpenConversationContactSameChannel'));
      }
      throw err;
    }
  }

  /** Templates a reply can use (the only option outside WhatsApp's 24h window). */
  async replyTemplates(tenant: TenantContext): Promise<{ items: { key: string; variables: string[] }[] }> {
    const rows = await this.prisma.messageTemplate.findMany({
      where: {
        channel: 'WHATSAPP',
        isActive: true,
        whatsappStatus: 'APPROVED',
        whatsappTemplateName: { not: null },
        OR: [{ studioId: tenant.studioId }, { studioId: null }],
      },
      select: { key: true, body: true },
    });
    const byKey = new Map<string, string[]>();
    for (const t of BUILTIN_TEMPLATES) byKey.set(t.key, [...t.variables]);
    for (const r of rows) if (!byKey.has(r.key)) byKey.set(r.key, messagePlaceholders(r.body));
    const hidden = new Set(['OTP', 'INBOX_HELP_REPLY', 'INBOX_OPT_OUT_CONFIRM', 'INVITE_LINK']);
    return {
      items: [...byKey.entries()].filter(([key]) => !hidden.has(key)).map(([key, variables]) => ({ key, variables })).sort((a, b) => a.key.localeCompare(b.key)),
    };
  }

  async listSavedReplies(tenant: TenantContext): Promise<{ items: SavedReplyDTO[] }> {
    const rows = await this.prisma.savedReply.findMany({ where: { studioId: tenant.studioId }, orderBy: { title: 'asc' } });
    return { items: rows.map((r) => ({ id: r.id, title: r.title, body: r.body, updatedAt: r.updatedAt.toISOString() })) };
  }

  async createSavedReply(tenant: TenantContext, dto: SavedReplyInput): Promise<SavedReplyDTO> {
    const r = await this.prisma.savedReply.create({
      data: { studioId: tenant.studioId, title: dto.title, body: dto.body, createdByMembershipId: tenant.membershipId },
    });
    return { id: r.id, title: r.title, body: r.body, updatedAt: r.updatedAt.toISOString() };
  }

  async updateSavedReply(tenant: TenantContext, id: string, dto: SavedReplyInput): Promise<SavedReplyDTO> {
    const changed = await this.prisma.savedReply.updateMany({ where: { id, studioId: tenant.studioId }, data: dto });
    if (changed.count === 0) throw new NotFoundException(apiError('apiErrors.messaging.quickReplyNotFound'));
    const r = await this.prisma.savedReply.findUniqueOrThrow({ where: { id } });
    return { id: r.id, title: r.title, body: r.body, updatedAt: r.updatedAt.toISOString() };
  }

  async deleteSavedReply(tenant: TenantContext, id: string): Promise<{ deleted: true }> {
    const removed = await this.prisma.savedReply.deleteMany({ where: { id, studioId: tenant.studioId } });
    if (removed.count === 0) throw new NotFoundException(apiError('apiErrors.messaging.quickReplyNotFound'));
    return { deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Member self-service (in-app chat and in-app messages)
  // ---------------------------------------------------------------------------

  async memberChat(tenant: TenantContext): Promise<MemberChatDTO> {
    const contact = await this.memberContact(tenant, false);
    if (!contact) return { conversationId: null, status: null, messages: [] };
    // The open conversation if there is one (the one the member's next message
    // and staff replies go to), else the most recent closed one. Not an
    // orderBy on status: Postgres sorts enums by declaration order (OPEN, CLOSED).
    const where = { studioId: tenant.studioId, contactId: contact.id, channel: 'IN_APP' as const };
    const conversation =
      (await this.prisma.conversation.findFirst({ where: { ...where, status: 'OPEN' }, orderBy: { lastMessageAt: 'desc' } })) ??
      (await this.prisma.conversation.findFirst({ where, orderBy: { lastMessageAt: 'desc' } }));
    if (!conversation) return { conversationId: null, status: null, messages: [] };
    const messages = await this.prisma.conversationMessage.findMany({
      where: { conversationId: conversation.id, studioId: tenant.studioId },
      include: MESSAGE_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { conversationId: conversation.id, status: conversation.status, messages: messages.reverse().map(toMessageDto) };
  }

  async memberSend(tenant: TenantContext, body: string): Promise<MemberChatDTO> {
    const contact = await this.memberContact(tenant, true);
    if (!contact) throw new ForbiddenException(apiError('apiErrors.messaging.chatOnlyMembers'));
    let conversation = await this.prisma.conversation.findFirst({
      where: { studioId: tenant.studioId, contactId: contact.id, channel: 'IN_APP', status: 'OPEN' },
    });
    if (!conversation) {
      try {
        conversation = await this.prisma.conversation.create({
          data: { studioId: tenant.studioId, contactId: contact.id, channel: 'IN_APP' },
        });
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
        conversation = await this.prisma.conversation.findFirstOrThrow({
          where: { studioId: tenant.studioId, contactId: contact.id, channel: 'IN_APP', status: 'OPEN' },
        });
      }
    }
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.conversationMessage.create({
        data: { studioId: tenant.studioId, conversationId: conversation.id, direction: 'IN', body, provider: 'IN_APP', status: 'RECEIVED' },
      }),
      this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: now, lastInboundAt: now, lastMessagePreview: body.slice(0, 200), unreadCount: { increment: 1 } },
      }),
    ]);
    return this.memberChat(tenant);
  }

  async inAppMessages(tenant: TenantContext, userId: string): Promise<{ items: InAppMessageDTO[] }> {
    const rows = await this.prisma.notificationLog.findMany({
      where: { studioId: tenant.studioId, userId, channel: 'IN_APP', status: { in: ['SENT', 'DELIVERED'] } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        subject: r.subject,
        body: r.content,
        createdAt: r.createdAt.toISOString(),
        readAt: r.readAt?.toISOString() ?? null,
      })),
    };
  }

  async markInAppRead(tenant: TenantContext, userId: string, id: string): Promise<{ read: true }> {
    const changed = await this.prisma.notificationLog.updateMany({
      where: { id, studioId: tenant.studioId, userId, channel: 'IN_APP', readAt: null },
      data: { readAt: new Date() },
    });
    if (changed.count === 0) {
      const exists = await this.prisma.notificationLog.count({ where: { id, studioId: tenant.studioId, userId, channel: 'IN_APP' } });
      if (exists === 0) throw new NotFoundException(apiError('apiErrors.messaging.messageNotFound'));
    }
    return { read: true };
  }

  // ---------------------------------------------------------------------------

  private async memberContact(tenant: TenantContext, create: boolean) {
    if (!tenant.membershipId || !tenant.memberProfileId) return null;
    const existing = await this.prisma.contact.findFirst({
      where: { studioId: tenant.studioId, membershipId: tenant.membershipId, mergedIntoId: null },
    });
    if (existing || !create) return existing;
    return this.crmHooks.onMemberJoined(tenant.studioId, tenant.membershipId);
  }

  private async appendOut(tenant: TenantContext, conversation: Conversation, body: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.conversationMessage.create({
        data: {
          studioId: tenant.studioId,
          conversationId: conversation.id,
          direction: 'OUT',
          body,
          provider: 'IN_APP',
          status: 'SENT',
          authorMembershipId: tenant.membershipId,
        },
      }),
      this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date(), lastMessagePreview: body.slice(0, 200) },
      }),
    ]);
  }

  private async getOwn(tenant: TenantContext, conversationId: string): Promise<ConversationWithRelations> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, studioId: tenant.studioId },
      include: CONVERSATION_INCLUDE,
    });
    if (!conversation) throw new NotFoundException(apiError('apiErrors.common.conversationNotFound'));
    return conversation;
  }

  private toSummary(c: ConversationWithRelations, showMemberContact: boolean): ConversationSummaryDTO {
    const hide = !showMemberContact && c.contact.membershipId !== null;
    const assigned = c.assignedMembership?.user;
    return {
      id: c.id,
      channel: c.channel as ConversationChannel,
      status: c.status,
      contact: {
        id: c.contact.id,
        displayName: contactDisplayName(c.contact),
        phone: hide ? null : c.contact.phone,
        email: hide ? null : c.contact.email,
      },
      assignedMembershipId: c.assignedMembershipId,
      assignedName: assigned ? `${assigned.firstName} ${assigned.lastName}`.trim() : null,
      lastMessageAt: c.lastMessageAt.toISOString(),
      lastInboundAt: c.lastInboundAt?.toISOString() ?? null,
      lastMessagePreview: c.lastMessagePreview,
      unreadCount: c.unreadCount,
      whatsappWindowOpen: c.channel === 'WHATSAPP' ? whatsappWindowOpen(c.lastInboundAt) : null,
    };
  }
}
