/** One outbound send attempt on a single phone channel (SMS or WhatsApp). */
export interface ChannelSendRequest {
  phone: string;
  /** Rendered message body (already substituted). */
  body: string;
  /** Named params as sent to the provider (e.g. WhatsApp template params). */
  params: Record<string, string>;
  /** WhatsApp: the Meta-approved template name. Omitted for a free-form reply. */
  whatsappTemplateName?: string;
  /** WhatsApp: template language code (the message locale). */
  languageCode?: string;
  /** WhatsApp: send `body` as free-form text (only inside the 24h customer-service window). */
  freeForm?: boolean;
  /** SMS sender header / originator, tenant-configurable. */
  senderName?: string;
}

export interface ChannelSendResult {
  success: boolean;
  providerMessageId?: string;
  errorMessage?: string;
  /** True when the adapter refused because it has no credentials (production only). */
  notConfigured?: boolean;
}

/**
 * A provider adapter for one delivery channel. Implementations must never
 * throw for an ordinary provider failure: they catch and return
 * { success: false, errorMessage }, so the caller can log and fall back.
 */
export interface MessageChannel {
  readonly name: 'WHATSAPP' | 'SMS';
  send(request: ChannelSendRequest): Promise<ChannelSendResult>;
}

/** SMS adapters are picked by the provider registry per country and tenant. */
export interface SmsChannelAdapter extends MessageChannel {
  readonly name: 'SMS';
  /** Provider registry key, e.g. NETGSM. */
  readonly key: 'NETGSM' | 'ILETI_MERKEZI' | 'TWILIO';
  /** Whether real credentials are set; unconfigured adapters simulate success (MOCK). */
  isConfigured(): boolean;
  getBalance(): Promise<{ credits: number | null; errorMessage?: string }>;
}

/** One outbound email. */
export interface EmailSendRequest {
  to: string;
  fromName: string;
  replyTo: string | null;
  subject: string;
  html: string;
  text: string;
  /** Extra headers, e.g. List-Unsubscribe and List-Unsubscribe-Post. */
  headers: Record<string, string>;
}
