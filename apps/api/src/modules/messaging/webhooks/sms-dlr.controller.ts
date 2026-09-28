import { All, Controller, ForbiddenException, HttpCode, NotFoundException, Param, Query, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { timingSafeEqual } from 'crypto';
import { DeliveryStatusService } from './delivery-status.service';
import type { DeliveryUpdateKind } from './delivery-status.service';

/**
 * Delivery reports from Netgsm and İleti Merkezi. Neither signs its
 * callbacks, so the report URL configured in the provider panel carries a
 * shared secret: /messaging/webhook/sms-dlr/<netgsm|iletimerkezi>?token=<SMS_DLR_WEBHOOK_TOKEN>.
 * Field names differ between providers and API versions; the id and status
 * are read from the common names below (query string or form/JSON body).
 * docs/MESAJLASMA.md lists what must be confirmed against each provider's
 * current documentation before going live.
 */
const ID_FIELDS = ['jobid', 'jobID', 'msgid', 'messageId', 'id', 'orderId'];
const STATUS_FIELDS = ['status', 'durum', 'stat', 'state'];

export function mapSmsDlrStatus(raw: string): DeliveryUpdateKind | null {
  const v = raw.trim().toLowerCase();
  if (['1', 'delivered', 'iletildi', 'success', '111'].includes(v)) return 'DELIVERED';
  if (['0', 'sent', 'waiting', 'beklemede', '110'].includes(v)) return 'SENT';
  if (['2', '3', '4', 'failed', 'undelivered', 'iletilmedi', 'expired', 'rejected', '112', '113', '114', '115', '117'].includes(v)) {
    return 'FAILED';
  }
  return null;
}

function pick(source: Record<string, unknown>, fields: string[]): string | null {
  for (const f of fields) {
    const v = source[f];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return null;
}

@Controller('messaging/webhook/sms-dlr')
export class SmsDlrController {
  constructor(
    private readonly delivery: DeliveryStatusService,
    private readonly config: ConfigService,
  ) {}

  @All(':provider')
  @HttpCode(200)
  async report(@Param('provider') provider: string, @Query('token') token: string | undefined, @Req() req: Request) {
    if (provider !== 'netgsm' && provider !== 'iletimerkezi') throw new NotFoundException();
    const expected = this.config.get<string>('SMS_DLR_WEBHOOK_TOKEN');
    if (!expected || !token || token.length !== expected.length || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
      throw new ForbiddenException();
    }
    const body = req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? (req.body as Record<string, unknown>) : {};
    const source: Record<string, unknown> = { ...(req.query as Record<string, unknown>), ...body };
    const id = pick(source, ID_FIELDS);
    const status = pick(source, STATUS_FIELDS);
    const kind = status ? mapSmsDlrStatus(status) : null;
    if (!id || !kind) return { updated: 0 };
    const updated = await this.delivery.apply({ providerMessageId: id, kind, detail: `${provider}_${status}` });
    return { updated };
  }
}
