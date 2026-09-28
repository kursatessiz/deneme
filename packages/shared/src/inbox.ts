import { z } from 'zod';
import { ENGINE_CHANNELS } from './messaging-engine';
import type { EngineChannel } from './messaging-engine';

/**
 * Inbox (Gelen kutusu): inbound WhatsApp/SMS replies and in-app member chat
 * as conversations staff can read, reply to, assign and close
 * (docs/MESAJLASMA.md, "Gelen kutusu").
 */

export const CONVERSATION_STATUSES = ['OPEN', 'CLOSED'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const MESSAGE_DIRECTIONS = ['IN', 'OUT'] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

/** Channels a conversation can run on (push is one-way). */
export const CONVERSATION_CHANNELS = ENGINE_CHANNELS.filter((c): c is Exclude<EngineChannel, 'PUSH'> => c !== 'PUSH');
export type ConversationChannel = Exclude<EngineChannel, 'PUSH'>;

export const ConversationListQuerySchema = z
  .object({
    status: z.enum(CONVERSATION_STATUSES).optional(),
    channel: z.enum(['EMAIL', 'SMS', 'WHATSAPP', 'IN_APP']).optional(),
    /** `me` = assigned to the caller, `unassigned` = nobody. */
    assigned: z.enum(['me', 'unassigned', 'any']).default('any'),
    search: z.string().trim().max(100).optional(),
    take: z.coerce.number().int().min(1).max(100).default(30),
    /** ISO timestamp: returns conversations whose last message is older (keyset paging). */
    before: z.string().datetime().optional(),
  })
  .strict();
export type ConversationListQuery = z.infer<typeof ConversationListQuerySchema>;

/** Staff reply: free text, or an approved template (required outside WhatsApp's 24h window). */
export const InboxReplySchema = z
  .object({
    body: z.string().trim().min(1).max(4000).optional(),
    templateKey: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,59}$/).optional(),
    variables: z.record(z.string().max(500)).default({}),
  })
  .strict()
  .refine((v) => Boolean(v.body) !== Boolean(v.templateKey), {
    message: 'Ya metin ya da şablon gönderilmelidir',
    path: ['body'],
  });
export type InboxReplyInput = z.infer<typeof InboxReplySchema>;

/** A staff membership id, `me` (the caller) or null to unassign. */
export const AssignConversationSchema = z.object({ membershipId: z.union([z.string().uuid(), z.literal('me')]).nullable() }).strict();
export type AssignConversationInput = z.infer<typeof AssignConversationSchema>;

export const UpdateConversationStatusSchema = z.object({ status: z.enum(CONVERSATION_STATUSES) }).strict();
export type UpdateConversationStatusInput = z.infer<typeof UpdateConversationStatusSchema>;

export const SavedReplySchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    body: z.string().trim().min(1).max(2000),
  })
  .strict();
export type SavedReplyInput = z.infer<typeof SavedReplySchema>;

/** A member writing to the studio from the app. */
export const MemberChatMessageSchema = z.object({ body: z.string().trim().min(1).max(2000) }).strict();
export type MemberChatMessageInput = z.infer<typeof MemberChatMessageSchema>;

export interface ConversationContactDTO {
  id: string;
  displayName: string;
  /** Masked unless the caller may see member contact details. */
  phone: string | null;
  email: string | null;
}

export interface ConversationSummaryDTO {
  id: string;
  channel: ConversationChannel;
  status: ConversationStatus;
  contact: ConversationContactDTO;
  assignedMembershipId: string | null;
  assignedName: string | null;
  lastMessageAt: string;
  lastInboundAt: string | null;
  lastMessagePreview: string;
  unreadCount: number;
  /** WhatsApp only: whether free-form replies are allowed right now. */
  whatsappWindowOpen: boolean | null;
}

export interface ConversationAttachmentDTO {
  kind: string;
  mimeType: string | null;
  providerMediaId: string | null;
  fileName: string | null;
}

export interface ConversationMessageDTO {
  id: string;
  direction: MessageDirection;
  body: string;
  status: string;
  authorName: string | null;
  attachments: ConversationAttachmentDTO[];
  createdAt: string;
}

export interface ConversationDetailDTO extends ConversationSummaryDTO {
  messages: ConversationMessageDTO[];
}

export interface SavedReplyDTO {
  id: string;
  title: string;
  body: string;
  updatedAt: string;
}

/** The member's own view of their chat with a studio. */
export interface MemberChatDTO {
  conversationId: string | null;
  status: ConversationStatus | null;
  messages: ConversationMessageDTO[];
}
