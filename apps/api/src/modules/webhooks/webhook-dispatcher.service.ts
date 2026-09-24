import { request as httpsRequest } from 'https';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolvePublicHttpsAddresses } from './ssrf-check';
import { buildSignatureHeader } from './webhook-signature';
import { WEBHOOK_AUTO_DISABLE_AFTER_FAILURES, WEBHOOK_MAX_ATTEMPTS, webhookBackoffSeconds } from '@platform/shared';

const DELIVERY_TIMEOUT_MS = 5000;
const RESPONSE_ERROR_TRUNCATE = 500;
/** Deliveries picked up per dispatcher tick, so one slow run cannot block the shared 15-minute heartbeat indefinitely. */
const BATCH_SIZE = 50;

export interface DispatchOutcome {
  attempted: number;
  succeeded: number;
  failed: number;
  abandoned: number;
}

/**
 * Delivers due WebhookDelivery rows over HTTPS with an HMAC signature,
 * 5s timeout and no redirects, retrying with exponential backoff up to
 * WEBHOOK_MAX_ATTEMPTS and auto-disabling an endpoint after too many
 * consecutive failures. Invoked from JobsService.runAll() every 15 minutes
 * (or the BullMQ repeatable job when REDIS_URL is set) and directly by
 * the redeliver/test-event staff endpoints' next dispatcher tick.
 */
@Injectable()
export class WebhookDispatcherService {
  private readonly logger = new Logger(WebhookDispatcherService.name);

  constructor(private readonly prisma: PrismaService) {}

  async dispatchDue(now = new Date()): Promise<DispatchOutcome> {
    const outcome: DispatchOutcome = { attempted: 0, succeeded: 0, failed: 0, abandoned: 0 };
    const due = await this.prisma.webhookDelivery.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: now } },
      include: { endpoint: true },
      take: BATCH_SIZE,
      orderBy: { nextAttemptAt: 'asc' },
    });

    for (const delivery of due) {
      outcome.attempted += 1;
      if (!delivery.endpoint.isActive) {
        await this.prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: { status: 'ABANDONED', lastError: 'Uç nokta pasif' },
        });
        outcome.abandoned += 1;
        continue;
      }

      const result = await this.deliverOnce(delivery.endpoint.url, delivery.endpoint.secret, delivery.payload);
      const attempt = delivery.attempt + 1;

      if (result.ok) {
        await this.prisma.$transaction([
          this.prisma.webhookDelivery.update({
            where: { id: delivery.id },
            data: { status: 'SUCCEEDED', attempt, responseCode: result.statusCode, nextAttemptAt: null, lastError: null },
          }),
          this.prisma.webhookEndpoint.update({ where: { id: delivery.endpoint.id }, data: { failureCount: 0 } }),
        ]);
        outcome.succeeded += 1;
        continue;
      }

      const willRetry = attempt < WEBHOOK_MAX_ATTEMPTS;
      const nextFailureCount = delivery.endpoint.failureCount + 1;
      const autoDisable = nextFailureCount >= WEBHOOK_AUTO_DISABLE_AFTER_FAILURES;

      await this.prisma.$transaction([
        this.prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: willRetry ? 'PENDING' : 'ABANDONED',
            attempt,
            responseCode: result.statusCode ?? null,
            lastError: result.error.slice(0, RESPONSE_ERROR_TRUNCATE),
            nextAttemptAt: willRetry ? new Date(now.getTime() + webhookBackoffSeconds(attempt) * 1000) : null,
          },
        }),
        this.prisma.webhookEndpoint.update({
          where: { id: delivery.endpoint.id },
          data: { failureCount: nextFailureCount, isActive: autoDisable ? false : undefined },
        }),
      ]);
      if (!willRetry) outcome.abandoned += 1;
      else outcome.failed += 1;
      if (autoDisable) {
        this.logger.warn(`Webhook endpoint ${delivery.endpoint.id} auto-disabled after ${nextFailureCount} consecutive failures`);
      }
    }

    return outcome;
  }

  private async deliverOnce(
    url: string,
    secret: string,
    payload: unknown,
  ): Promise<{ ok: boolean; statusCode?: number; error: string }> {
    let pinnedAddress: string;
    let pinnedFamily: 4 | 6;
    try {
      // Re-resolved and re-checked at delivery time (not only at endpoint
      // creation) so a hostname re-pointed at a private address after
      // creation cannot be used to reach internal services (SSRF). The
      // resolved address is then pinned for the actual connection below
      // instead of letting the HTTP client re-resolve the hostname itself:
      // re-resolving would reopen the same hole one request later (DNS
      // rebinding) -- an attacker's DNS server can answer this lookup with
      // a public IP and the next one, milliseconds later, with a private
      // one, and a hostname-only check can never see the difference.
      const addresses = await resolvePublicHttpsAddresses(url);
      pinnedAddress = addresses[0].address;
      pinnedFamily = addresses[0].family;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'SSRF check failed' };
    }

    const body = JSON.stringify(payload);
    const signature = buildSignatureHeader(secret, body);
    const target = new URL(url);

    return new Promise((resolve) => {
      const req = httpsRequest(
        {
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port || 443,
          path: `${target.pathname}${target.search}`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Signature': signature, 'Content-Length': Buffer.byteLength(body) },
          timeout: DELIVERY_TIMEOUT_MS,
          // TLS validation still checks the certificate against `hostname`
          // (Node defaults `servername` to it); only the socket's actual
          // destination is pinned to the address validated above.
          lookup: (_hostname, _options, callback) => callback(null, pinnedAddress, pinnedFamily),
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const status = res.statusCode ?? 0;
            const text = Buffer.concat(chunks).toString('utf8');
            // Node's http client never follows redirects on its own, so a
            // 3xx simply falls through to the failure branch below, same as
            // any other non-2xx status -- no redirect is ever followed.
            if (status >= 200 && status < 300) {
              resolve({ ok: true, statusCode: status, error: '' });
            } else {
              resolve({ ok: false, statusCode: status, error: `HTTP ${status}: ${text}` });
            }
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error('Zaman aşımı')));
      req.on('error', (err) => resolve({ ok: false, error: err.message }));
      req.write(body);
      req.end();
    });
  }
}
