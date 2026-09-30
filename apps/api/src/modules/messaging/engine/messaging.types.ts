import type { EngineChannel, MessagePurpose, MessageSendReasonCode, NotificationCategory } from '@platform/shared';

/** Who receives the message. Exactly one form. */
export type RecipientRef =
  | { contactId: string }
  | { membershipId: string }
  | { userId: string }
  /** Raw address: platform messages (login codes) and invitees without an account. */
  | { phone: string }
  | { email: string };

export interface MessageContentOverrides {
  subject?: string;
  preheader?: string;
  body?: string;
}

export interface SendMessageInput {
  /** Null only for platform messages to a raw address (login codes). */
  studioId: string | null;
  recipient: RecipientRef;
  /** One channel, or an attempt order; neither = the tenant's WhatsApp -> SMS order. */
  channel?: EngineChannel;
  channels?: EngineChannel[];
  /**
   * TRANSACTIONAL (default) or COMMERCIAL. A template marked
   * non-transactional always sends as COMMERCIAL, whatever the caller says.
   */
  purpose?: MessagePurpose;
  /** Template by key (resolved per channel and locale) or a specific tenant/global row. */
  templateKey?: string;
  templateId?: string;
  /**
   * Per-send content overrides of the resolved template (campaign A/B
   * variants): e-mail subject, preheader and body, SMS body. WhatsApp always
   * sends its approved template and ignores them. Placeholders render
   * strictly, like the template's own.
   */
  overrides?: MessageContentOverrides;
  /** Free text instead of a template (inbox replies, legacy notifications). */
  content?: { subject?: string | null; text: string; data?: Record<string, string> };
  /** Defaults to the contact's, then the user's, then the studio's language. */
  locale?: string | null;
  variables?: Record<string, string | number>;
  /** Same key again (per studio) returns the first result instead of sending twice. */
  idempotencyKey?: string;
  campaignId?: string;
  journeyRunId?: string;
  /** Legacy notification category: the member's push/SMS toggles still apply. */
  category?: NotificationCategory;
  /** Codes and links: the content is never written to logs or the database. */
  sensitive?: boolean;
  /** NotificationLog.type; defaults to the template key. */
  type?: string;
  /** EXEMPT: identity flows (OTP, invites) are never blocked by the tenant's SMS wallet. */
  billing?: 'WALLET' | 'EXEMPT';
  /** WhatsApp free-form text (inbox reply inside the 24h window). */
  whatsappFreeForm?: boolean;
  /** PUSH with a template: extra data delivered with the notification (screen to open, ids). Free text uses content.data. */
  pushData?: Record<string, string>;
  /** Also append the attempt to this inbox conversation as an outgoing message. */
  conversationId?: string;
  authorMembershipId?: string | null;
}

export interface SendMessageResult {
  success: boolean;
  channel?: EngineChannel;
  providerMessageId?: string;
  notificationLogId?: string;
  /** The idempotency key was already used; nothing was sent again. */
  duplicate?: boolean;
  /** Why no channel delivered (Turkish, for logs and staff diagnostics). */
  reason?: string;
  reasonCode?: MessageSendReasonCode;
  /** PUSH: number of devices the message was handed to. */
  pushedDevices?: number;
}

/** Everything the engine knows about the recipient after resolution. */
export interface ResolvedRecipient {
  contactId: string | null;
  userId: string | null;
  membershipId: string | null;
  firstName: string | null;
  phone: string | null;
  email: string | null;
  locale: string | null;
  countryCode: string | null;
  timezone: string | null;
}
