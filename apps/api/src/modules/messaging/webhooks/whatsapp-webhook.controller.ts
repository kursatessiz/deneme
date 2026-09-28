import { Controller, ForbiddenException, Get, Headers, HttpCode, Logger, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ConversationAttachmentDTO } from '@platform/shared';
import { WhatsAppCloudAdapter } from '../channels/whatsapp-cloud.adapter';
import { DeliveryStatusService } from './delivery-status.service';
import type { DeliveryUpdateKind } from './delivery-status.service';
import { InboundService } from '../inbox/inbound.service';

interface WaMessage {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  [media: string]: unknown;
}
interface WaStatus {
  id?: string;
  status?: string;
  timestamp?: string;
  errors?: { code?: number; title?: string }[];
}
interface WaValue {
  metadata?: { phone_number_id?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: WaMessage[];
  statuses?: WaStatus[];
}
interface WaPayload {
  object?: string;
  entry?: { changes?: { field?: string; value?: WaValue }[] }[];
}

const STATUS_MAP: Record<string, DeliveryUpdateKind | undefined> = {
  sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'READ',
  failed: 'FAILED',
};
/** Meta error 131026: the number cannot receive WhatsApp messages. */
const PERMANENT_WA_ERRORS = new Set([131026]);
const MEDIA_TYPES = ['image', 'audio', 'video', 'document', 'sticker'];

function tsToDate(ts: string | undefined): Date {
  const seconds = Number(ts);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date();
}

/**
 * WhatsApp Cloud API webhook: the GET subscription handshake and signed
 * POST notifications (message statuses and inbound messages). The POST body
 * arrives raw (see common/body-parsers.ts) so X-Hub-Signature-256 is
 * checked against the exact bytes Meta signed; nothing is parsed before.
 */
@Controller('messaging/webhook/whatsapp')
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(
    private readonly whatsapp: WhatsAppCloudAdapter,
    private readonly delivery: DeliveryStatusService,
    private readonly inbound: InboundService,
  ) {}

  @Get()
  verify(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
    @Res() res: Response,
  ): void {
    if (!this.whatsapp.verifySubscription(mode, token) || !challenge) throw new ForbiddenException();
    res.status(200).type('text/plain').send(challenge.slice(0, 200));
  }

  @Post()
  @HttpCode(200)
  async receive(@Req() req: Request, @Headers('x-hub-signature-256') signature: string | undefined): Promise<{ received: true }> {
    const raw: unknown = req.body;
    if (!Buffer.isBuffer(raw) || !this.whatsapp.verifyWebhookSignature(raw, signature)) {
      this.logger.warn('Rejected WhatsApp webhook: signature did not verify');
      throw new ForbiddenException();
    }
    let payload: WaPayload;
    try {
      payload = JSON.parse(raw.toString('utf8')) as WaPayload;
    } catch {
      return { received: true };
    }
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value) continue;
        for (const status of value.statuses ?? []) await this.applyStatus(status);
        for (const message of value.messages ?? []) await this.applyMessage(message, value);
      }
    }
    return { received: true };
  }

  private async applyStatus(status: WaStatus): Promise<void> {
    const kind = STATUS_MAP[status.status ?? ''];
    if (!status.id || !kind) return;
    const error = status.errors?.[0];
    await this.delivery.apply({
      providerMessageId: status.id,
      kind,
      permanent: kind === 'FAILED' && error?.code !== undefined && PERMANENT_WA_ERRORS.has(error.code),
      errorMessage: error ? `${error.code ?? ''} ${error.title ?? ''}`.trim() : null,
      detail: error?.code ? `wa_${error.code}` : null,
      occurredAt: tsToDate(status.timestamp),
    });
  }

  private async applyMessage(message: WaMessage, value: WaValue): Promise<void> {
    if (!message.from || !message.id || !/^\d{6,15}$/.test(message.from)) return;
    const profile = value.contacts?.find((c) => c.wa_id === message.from)?.profile?.name ?? null;
    const text =
      message.text?.body ?? message.button?.text ?? message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title ?? '';
    const attachments: ConversationAttachmentDTO[] = [];
    if (message.type && MEDIA_TYPES.includes(message.type)) {
      const media = message[message.type] as { id?: string; mime_type?: string; filename?: string } | undefined;
      attachments.push({ kind: message.type, mimeType: media?.mime_type ?? null, providerMediaId: media?.id ?? null, fileName: media?.filename ?? null });
    }
    await this.inbound.receive({
      channel: 'WHATSAPP',
      provider: 'WHATSAPP_CLOUD',
      from: `+${message.from}`,
      phoneNumberId: value.metadata?.phone_number_id ?? null,
      profileName: profile,
      body: text,
      providerMessageId: message.id,
      attachments,
      receivedAt: tsToDate(message.timestamp),
    });
  }
}
