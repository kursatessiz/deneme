/** One outbound send attempt on a single channel. */
export interface ChannelSendRequest {
  phone: string;
  /** Rendered message body (already substituted). */
  body: string;
  /** Named params as sent to the provider (e.g. WhatsApp template params). */
  params: Record<string, string>;
  /** Required for WhatsApp: the Meta-approved template name. */
  whatsappTemplateName?: string;
  /** SMS sender header / originator, tenant-configurable. */
  senderName?: string;
}

export interface ChannelSendResult {
  success: boolean;
  providerMessageId?: string;
  errorMessage?: string;
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
