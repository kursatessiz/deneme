import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@platform/database';
import {
  CONVERSION_MAX_ATTEMPTS,
  conversionDeliveryBackoffSeconds,
  type AdConnectionCredentials,
  type AdConnectionPlatform,
  type ConversionActionMap,
  type ConversionDeliveryTarget,
  type ConversionEventType,
  type GoogleCredentials,
  type MetaCredentials,
  type TikTokCredentials,
} from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CredentialCipher } from '../../../common/crypto/credential-cipher';
import { AdsHttpClient } from '../ads-http-client';
import type { DeliveryContext } from './delivery-context';
import { buildGoogleAdsPayload } from './google-ads.adapter';
import { refreshGoogleAccessToken } from './google-oauth';
import { buildMetaCapiPayload } from './meta-capi.adapter';
import { buildTikTokEventsPayload } from './tiktok-events.adapter';

const BATCH_SIZE = 50;
const PLATFORM_BY_TARGET: Record<ConversionDeliveryTarget, AdConnectionPlatform | null> = {
  META_CAPI: 'META',
  GOOGLE_ADS: 'GOOGLE',
  TIKTOK_EVENTS: 'TIKTOK',
  LINKEDIN_CAPI: null, // adapter not built yet (see docs/BUYUME_VE_GLOBAL_MIMARI.md 3.3)
};

export interface DispatchOutcome {
  attempted: number;
  sent: number;
  skipped: number;
  retrying: number;
  failed: number;
}

/**
 * Delivers due ConversionDelivery rows to Meta CAPI / Google Ads / TikTok
 * Events, following the same due-row polling shape as
 * WebhookDispatcherService rather than a separate BullMQ queue per event:
 * the production box (CLAUDE.md, 6 GB RAM) has no headroom for another
 * worker process, and the CONVERSION_RETRY_DELAYS_SECONDS backoff needs no
 * more than a shared heartbeat. Invoked from JobsService.runAll() every 15
 * minutes (or the BullMQ repeatable job when REDIS_URL is set).
 */
@Injectable()
export class ConversionDeliveryDispatcherService {
  private readonly logger = new Logger(ConversionDeliveryDispatcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: CredentialCipher,
    private readonly http: AdsHttpClient,
  ) {}

  async dispatchDue(now = new Date()): Promise<DispatchOutcome> {
    const outcome: DispatchOutcome = { attempted: 0, sent: 0, skipped: 0, retrying: 0, failed: 0 };
    const due = await this.prisma.conversionDelivery.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: now } },
      include: {
        conversionEvent: { include: { contact: true, attributedTouchpoint: true, studio: { select: { timezone: true } } } },
      },
      take: BATCH_SIZE,
      orderBy: { nextAttemptAt: 'asc' },
    });

    for (const delivery of due) {
      outcome.attempted += 1;
      try {
        const result = await this.deliverOne(delivery);
        if (result.status === 'SENT') outcome.sent += 1;
        else if (result.status === 'PENDING') outcome.retrying += 1;
        else if (result.status === 'FAILED') outcome.failed += 1;
        else outcome.skipped += 1;
      } catch (err) {
        this.logger.error(`Delivery ${delivery.id} threw unexpectedly: ${err instanceof Error ? err.message : String(err)}`);
        outcome.failed += 1;
      }
    }
    return outcome;
  }

  private async deliverOne(
    delivery: Prisma.ConversionDeliveryGetPayload<{
      include: { conversionEvent: { include: { contact: true; attributedTouchpoint: true; studio: { select: { timezone: true } } } } };
    }>,
  ) {
    const target = delivery.target as ConversionDeliveryTarget;
    const platform = PLATFORM_BY_TARGET[target];
    if (!platform) return this.terminal(delivery.id, 'FAILED', 'Bu hedef için adaptör yok');

    const connection = await this.prisma.adConnection.findFirst({
      where: { studioId: delivery.studioId, platform, status: 'CONNECTED' },
    });
    if (!connection) return this.terminal(delivery.id, 'FAILED', 'Bağlı reklam hesabı bulunamadı');

    const credentials = JSON.parse(this.cipher.decrypt(connection.encryptedCredentials)) as AdConnectionCredentials;
    const event = delivery.conversionEvent;
    const ctx: DeliveryContext = {
      eventId: event.eventId,
      type: event.type as ConversionEventType,
      occurredAt: event.occurredAt,
      value: event.valueAmount && event.currency ? { amount: event.valueAmount.toFixed(2), currency: event.currency } : null,
      contact: {
        id: event.contact.id,
        firstName: event.contact.firstName,
        lastName: event.contact.lastName,
        phone: event.contact.phone,
        email: event.contact.email,
        countryCode: event.contact.countryCode,
      },
      touchpoint: event.attributedTouchpoint
        ? {
            occurredAt: event.attributedTouchpoint.occurredAt,
            advertisingConsent: event.attributedTouchpoint.advertisingConsent,
            landingHost: event.attributedTouchpoint.landingHost,
            landingPath: event.attributedTouchpoint.landingPath,
            fbp: event.attributedTouchpoint.fbp,
            fbc: event.attributedTouchpoint.fbc,
            gclid: event.attributedTouchpoint.gclid,
            gbraid: event.attributedTouchpoint.gbraid,
            wbraid: event.attributedTouchpoint.wbraid,
            ttclid: event.attributedTouchpoint.ttclid,
          }
        : null,
      connection: {
        platform,
        externalAccountId: connection.externalAccountId,
        pixelOrDatasetId: connection.pixelOrDatasetId,
        conversionActionIds: connection.conversionActionIds as ConversionActionMap as Partial<Record<ConversionEventType, string>>,
        isTestMode: connection.isTestMode,
      },
      studioTimezone: event.studio.timezone,
    };

    try {
      if (platform === 'META') return await this.sendMeta(delivery.id, ctx, credentials as MetaCredentials);
      if (platform === 'GOOGLE') return await this.sendGoogle(delivery.id, ctx, credentials as GoogleCredentials);
      return await this.sendTikTok(delivery.id, ctx, credentials as TikTokCredentials);
    } catch (err) {
      return this.retryOrFail(delivery.id, delivery.attempts, err instanceof Error ? err.message : String(err));
    }
  }

  private async sendMeta(deliveryId: string, ctx: DeliveryContext, credentials: MetaCredentials) {
    const built = buildMetaCapiPayload(ctx, credentials.testEventCode);
    if (built.skip) return this.terminal(deliveryId, built.skip, null);
    const url = `${built.request!.url}?access_token=${encodeURIComponent(credentials.accessToken)}`;
    const res = await this.http.postJson('META', url, {}, built.request!.body);
    return this.afterSend(deliveryId, res.ok, res.ok ? null : JSON.stringify(res.body).slice(0, 900));
  }

  private async sendGoogle(deliveryId: string, ctx: DeliveryContext, credentials: GoogleCredentials) {
    const built = buildGoogleAdsPayload(ctx, credentials.loginCustomerId);
    if (built.skip) return this.terminal(deliveryId, built.skip, null);
    const accessToken = await refreshGoogleAccessToken(this.http, credentials);
    const res = await this.http.postJson(
      'GOOGLE',
      built.request!.url,
      {
        authorization: `Bearer ${accessToken}`,
        'developer-token': credentials.developerToken,
        'login-customer-id': built.request!.loginCustomerId,
      },
      built.request!.body,
    );
    return this.afterSend(deliveryId, res.ok, res.ok ? null : JSON.stringify(res.body).slice(0, 900));
  }

  private async sendTikTok(deliveryId: string, ctx: DeliveryContext, credentials: TikTokCredentials) {
    const built = buildTikTokEventsPayload(ctx);
    if (built.skip) return this.terminal(deliveryId, built.skip, null);
    const res = await this.http.postJson('TIKTOK', built.request!.url, { 'access-token': credentials.accessToken }, built.request!.body);
    return this.afterSend(deliveryId, res.ok, res.ok ? null : JSON.stringify(res.body).slice(0, 900));
  }

  private async afterSend(deliveryId: string, ok: boolean, error: string | null) {
    if (ok) {
      return this.prisma.conversionDelivery.update({
        where: { id: deliveryId },
        data: { status: 'SENT', attempts: { increment: 1 }, sentAt: new Date(), nextAttemptAt: null, lastError: null },
      });
    }
    const current = await this.prisma.conversionDelivery.findUniqueOrThrow({ where: { id: deliveryId }, select: { attempts: true } });
    return this.retryOrFail(deliveryId, current.attempts, error ?? 'Bilinmeyen hata');
  }

  /** Reuses the same row across retries (idempotent): attempts is incremented, never re-created. */
  private async retryOrFail(deliveryId: string, previousAttempts: number, error: string) {
    const attempt = previousAttempts + 1;
    if (attempt < CONVERSION_MAX_ATTEMPTS) {
      return this.prisma.conversionDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'PENDING',
          attempts: attempt,
          lastError: error.slice(0, 900),
          nextAttemptAt: new Date(Date.now() + conversionDeliveryBackoffSeconds(attempt) * 1000),
        },
      });
    }
    // Dead-letter: attempts exhausted, no further retry.
    return this.prisma.conversionDelivery.update({
      where: { id: deliveryId },
      data: { status: 'FAILED', attempts: attempt, lastError: error.slice(0, 900), nextAttemptAt: null },
    });
  }

  private async terminal(deliveryId: string, status: 'FAILED' | 'SKIPPED_NO_CONSENT' | 'SKIPPED_NO_MATCH', error: string | null) {
    return this.prisma.conversionDelivery.update({
      where: { id: deliveryId },
      data: { status, lastError: error, nextAttemptAt: null },
    });
  }
}
