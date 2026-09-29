import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@platform/database';
import type { Contact, Conversation, NotificationChannel } from '@platform/database';
import { classifyInboundKeyword, countryOfPhone, recipientRegion } from '@platform/shared';
import type { ConversationAttachmentDTO, InboundKeyword } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ContactsService } from '../../crm/contacts/contacts.service';
import { GrowthEventsService } from '../../crm/hooks/growth-events.service';
import { MessagingService } from '../engine/messaging.service';
import { OptOutService } from '../engine/opt-out.service';

export interface InboundMessage {
  channel: 'SMS' | 'WHATSAPP';
  provider: 'TWILIO' | 'WHATSAPP_CLOUD';
  /** Sender, E.164. */
  from: string;
  /** Our number the message was sent to (Twilio "To"). */
  to?: string | null;
  /** WhatsApp Cloud metadata.phone_number_id of our number. */
  phoneNumberId?: string | null;
  /** WhatsApp profile name, used for a new contact's first name. */
  profileName?: string | null;
  body: string;
  providerMessageId: string;
  attachments: ConversationAttachmentDTO[];
  receivedAt: Date;
}

export interface InboundResult {
  studioId: string;
  contactId: string;
  conversationId: string;
  duplicate: boolean;
  keyword: InboundKeyword | null;
}

/**
 * Inbound WhatsApp and SMS (docs/MESAJLASMA.md, "Gelen mesajlar"):
 *   1. route to a studio: the tenant's own number (messaging settings), else
 *      the most recent conversation or outbound message with this phone on
 *      this channel (shared platform number); otherwise the message is
 *      dropped and logged;
 *   2. match or create the contact by phone through the CRM (source INBOUND);
 *   3. append to the contact's open conversation (webhook retries are
 *      de-duplicated by provider message id);
 *   4. keywords, per the sender's region: STOP/UNSUBSCRIBE/IPTAL/DUR (and
 *      regional words) opt the contact out of commercial messages on this
 *      channel; HELP/YARDIM gets the help reply.
 */
@Injectable()
export class InboundService {
  private readonly logger = new Logger(InboundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
    private readonly messaging: MessagingService,
    private readonly optOut: OptOutService,
    private readonly events: GrowthEventsService,
  ) {}

  async receive(msg: InboundMessage): Promise<InboundResult | null> {
    const studioId = await this.routeStudio(msg);
    if (!studioId) {
      this.logger.warn(`Inbound ${msg.channel} message could not be routed to a studio; dropped`);
      return null;
    }
    const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: studioId }, select: { countryCode: true } });

    const { contact } = await this.contacts.resolveOrCreate(studioId, {
      firstName: (msg.profileName?.trim() || msg.from).slice(0, 60),
      phone: msg.from,
      countryCode: countryOfPhone(msg.from),
      sourceChannel: 'INBOUND',
      sourceDetail: msg.channel,
    });

    const conversation = await this.openConversation(studioId, contact.id, msg.channel, msg.from);
    const body = msg.body.slice(0, 4000);
    try {
      await this.prisma.conversationMessage.create({
        data: {
          studioId,
          conversationId: conversation.id,
          direction: 'IN',
          body,
          provider: msg.provider,
          providerMessageId: msg.providerMessageId,
          status: 'RECEIVED',
          attachments: msg.attachments as unknown as Prisma.InputJsonValue,
          createdAt: msg.receivedAt,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return { studioId, contactId: contact.id, conversationId: conversation.id, duplicate: true, keyword: null };
      }
      throw err;
    }
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: msg.receivedAt,
        lastInboundAt: msg.receivedAt,
        lastMessagePreview: (body || (msg.attachments[0]?.kind ?? '')).slice(0, 200),
        unreadCount: { increment: 1 },
        externalAddress: msg.from,
      },
    });

    const region = recipientRegion({ countryCode: contact.countryCode, phone: msg.from, studioCountryCode: studio.countryCode });
    const keyword = classifyInboundKeyword(body, region);
    if (keyword === 'OPT_OUT') await this.handleOptOut(studioId, contact, conversation, msg, studio.countryCode);
    if (keyword === 'HELP') await this.reply(studioId, contact.id, conversation.id, msg.channel, 'INBOX_HELP_REPLY');
    if (!keyword) {
      await this.events.emit({ studioId, contactId: contact.id, event: 'message_replied', ref: `msg:${msg.providerMessageId}`, occurredAt: msg.receivedAt });
    }

    return { studioId, contactId: contact.id, conversationId: conversation.id, duplicate: false, keyword };
  }

  private async handleOptOut(studioId: string, contact: Contact, conversation: Conversation, msg: InboundMessage, studioCountry: string) {
    const membership = contact.membershipId
      ? await this.prisma.membership.findUnique({ where: { id: contact.membershipId }, select: { userId: true } })
      : null;
    await this.optOut.optOut({
      studioId,
      channel: msg.channel,
      address: msg.from,
      reason: 'STOP_KEYWORD',
      contactId: contact.id,
      userId: membership?.userId ?? null,
      countryCode: contact.countryCode ?? countryOfPhone(msg.from) ?? studioCountry,
      source: 'stop-keyword',
    });
    // Twilio answers STOP on SMS itself (carrier rules); WhatsApp gets our confirmation.
    if (msg.channel === 'WHATSAPP') await this.reply(studioId, contact.id, conversation.id, msg.channel, 'INBOX_OPT_OUT_CONFIRM');
  }

  private async reply(studioId: string, contactId: string, conversationId: string, channel: 'SMS' | 'WHATSAPP', templateKey: string) {
    const result = await this.messaging.send({
      studioId,
      recipient: { contactId },
      channel,
      purpose: 'TRANSACTIONAL',
      templateKey,
      whatsappFreeForm: channel === 'WHATSAPP',
      conversationId,
    });
    if (!result.success) this.logger.warn(`Keyword reply ${templateKey} not sent: ${result.reason ?? 'unknown'}`);
  }

  private async openConversation(studioId: string, contactId: string, channel: NotificationChannel, address: string): Promise<Conversation> {
    const existing = await this.prisma.conversation.findFirst({ where: { studioId, contactId, channel, status: 'OPEN' } });
    if (existing) return existing;
    try {
      return await this.prisma.conversation.create({ data: { studioId, contactId, channel, externalAddress: address } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.prisma.conversation.findFirst({ where: { studioId, contactId, channel, status: 'OPEN' } });
        if (winner) return winner;
      }
      throw err;
    }
  }

  /** Tenant's own number first; otherwise the newest trace of this phone on this channel. */
  async routeStudio(msg: Pick<InboundMessage, 'channel' | 'from' | 'to' | 'phoneNumberId'>): Promise<string | null> {
    if (msg.channel === 'WHATSAPP' && msg.phoneNumberId) {
      const own = await this.prisma.studio.findFirst({
        where: { messagingSettings: { path: ['whatsappPhoneNumberId'], equals: msg.phoneNumberId } },
        select: { id: true },
      });
      if (own) return own.id;
    }
    if (msg.channel === 'SMS' && msg.to) {
      const own = await this.prisma.studio.findFirst({
        where: { messagingSettings: { path: ['inboundSmsNumber'], equals: msg.to } },
        select: { id: true },
      });
      if (own) return own.id;
    }
    const [conversation, outbound] = await Promise.all([
      this.prisma.conversation.findFirst({
        where: { channel: msg.channel, externalAddress: msg.from },
        orderBy: { lastMessageAt: 'desc' },
        select: { studioId: true, lastMessageAt: true },
      }),
      this.prisma.notificationLog.findFirst({
        where: { channel: msg.channel, recipientPhone: msg.from, studioId: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { studioId: true, createdAt: true },
      }),
    ]);
    if (conversation && outbound) {
      return conversation.lastMessageAt >= outbound.createdAt ? conversation.studioId : outbound.studioId;
    }
    return conversation?.studioId ?? outbound?.studioId ?? null;
  }
}
