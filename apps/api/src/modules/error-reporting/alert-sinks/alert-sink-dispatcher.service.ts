import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WEBHOOK_MAX_ATTEMPTS, webhookBackoffSeconds } from '@platform/shared';
import type { ErrorAlertNotification, ErrorAlertRecordKind, ErrorSource } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ALERT_SINKS } from './alert-sink';
import type { AlertDeliveryOutcome, AlertSink } from './alert-sink';

/** Deliveries picked up per heartbeat tick, so a run cannot block the shared heartbeat for long. */
const RETRY_BATCH = 25;
/** A claimed delivery is not picked up again by a parallel tick for this long. */
const CLAIM_LEASE_MS = 5 * 60 * 1000;
const ERROR_TEXT_LIMIT = 200;

export interface RetryOutcome {
  attempted: number;
  succeeded: number;
  abandoned: number;
}

function describeFailure(err: unknown): string {
  // The error class only: messages of network errors can carry the destination host or address.
  return (err instanceof Error ? err.name : 'Error').slice(0, ERROR_TEXT_LIMIT);
}

/**
 * Fans an alert out to every active sink and retries failures with the
 * webhook backoff schedule (0, 30 s, 2 min, 10 min, 30 min, 1 h; six
 * attempts), driven by the 15-minute heartbeat like the public webhooks.
 * One error_alert_deliveries row per alert and sink; a delivery is claimed
 * with a conditional update before it is attempted, so two ticks never send
 * the same one. Failures are logged as the sink name and the status or error
 * class only: never the payload, the destination or a response body.
 */
@Injectable()
export class AlertSinkDispatcher {
  private readonly logger = new Logger(AlertSinkDispatcher.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(ALERT_SINKS) private readonly sinks: AlertSink[],
  ) {}

  /** Creates a delivery for every active sink and makes the first attempt. Never throws. */
  async dispatch(alertId: string, now = new Date()): Promise<void> {
    try {
      for (const sink of this.sinks) {
        if (!(await sink.isActive())) continue;
        const delivery = await this.prisma.errorAlertDelivery.create({
          data: { alertId, sink: sink.kind, status: 'PENDING', nextAttemptAt: now },
        });
        await this.attempt(delivery.id, now);
      }
    } catch (err) {
      this.logger.warn(`Alert sink dispatch failed: ${describeFailure(err)}`);
    }
  }

  /** Retries due deliveries; called by the heartbeat. */
  async retryDue(now: Date): Promise<RetryOutcome> {
    const outcome: RetryOutcome = { attempted: 0, succeeded: 0, abandoned: 0 };
    const due = await this.prisma.errorAlertDelivery.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: 'asc' },
      take: RETRY_BATCH,
      select: { id: true },
    });
    for (const { id } of due) {
      const result = await this.attempt(id, now);
      if (result === 'skipped') continue;
      outcome.attempted++;
      if (result === 'SUCCEEDED') outcome.succeeded++;
      if (result === 'ABANDONED') outcome.abandoned++;
    }
    return outcome;
  }

  private async attempt(deliveryId: string, now: Date): Promise<'SUCCEEDED' | 'PENDING' | 'ABANDONED' | 'skipped'> {
    const claimed = await this.prisma.errorAlertDelivery.updateMany({
      where: { id: deliveryId, status: 'PENDING', nextAttemptAt: { lte: now } },
      data: { nextAttemptAt: new Date(now.getTime() + CLAIM_LEASE_MS) },
    });
    if (claimed.count === 0) return 'skipped';

    const delivery = await this.prisma.errorAlertDelivery.findUnique({ where: { id: deliveryId } });
    if (!delivery) return 'skipped';
    const sink = this.sinks.find((s) => s.kind === delivery.sink);
    const notification = sink ? await this.notificationFor(delivery.alertId) : null;

    let outcome: AlertDeliveryOutcome;
    if (!sink || !notification) {
      outcome = { ok: false, statusCode: null, error: !sink ? 'SINK_UNAVAILABLE' : 'ALERT_GONE', retryable: false };
    } else if (!(await sink.isActive())) {
      // Switched off or removed since the alert was raised: nothing to deliver to any more.
      outcome = { ok: false, statusCode: null, error: 'SINK_INACTIVE', retryable: false };
    } else {
      try {
        outcome = await sink.deliver(notification);
      } catch (err) {
        outcome = { ok: false, statusCode: null, error: describeFailure(err), retryable: true };
      }
    }

    const attempt = delivery.attempt + 1;
    if (outcome.ok) {
      await this.prisma.errorAlertDelivery.update({
        where: { id: deliveryId },
        data: { status: 'SUCCEEDED', attempt, nextAttemptAt: null, lastStatusCode: outcome.statusCode, lastError: null },
      });
      return 'SUCCEEDED';
    }

    const willRetry = outcome.retryable && attempt < WEBHOOK_MAX_ATTEMPTS;
    this.logger.warn(`Alert sink ${delivery.sink} delivery ${deliveryId} failed (attempt ${attempt}): ${outcome.error}`);
    await this.prisma.errorAlertDelivery.update({
      where: { id: deliveryId },
      data: {
        status: willRetry ? 'PENDING' : 'ABANDONED',
        attempt,
        lastStatusCode: outcome.statusCode,
        lastError: outcome.error.slice(0, ERROR_TEXT_LIMIT),
        nextAttemptAt: willRetry ? new Date(now.getTime() + webhookBackoffSeconds(attempt + 1) * 1000) : null,
      },
    });
    return willRetry ? 'PENDING' : 'ABANDONED';
  }

  private appUrl(): string {
    return (this.config.get<string>('PUBLIC_APP_URL') ?? 'http://localhost:3000').replace(/\/+$/, '');
  }

  /** The scrubbed summary a sink receives, rebuilt from the stored alert so retries need no stored payload. */
  private async notificationFor(alertId: string): Promise<ErrorAlertNotification | null> {
    const alert = await this.prisma.errorAlert.findUnique({ where: { id: alertId }, include: { group: true } });
    if (!alert) return null;
    return {
      alertId: alert.id,
      kind: alert.kind as ErrorAlertRecordKind,
      groupId: alert.groupId,
      title: alert.group.title,
      source: alert.group.source as ErrorSource,
      release: alert.group.lastRelease,
      code: alert.group.lastCode,
      windowCount: alert.windowCount,
      baselineMean: alert.baselineMean,
      threshold: alert.threshold,
      affectedStudioCount: alert.group.affectedStudioCount,
      occurredAt: alert.createdAt.toISOString(),
      link: `${this.appUrl()}/admin/hatalar/${alert.groupId}`,
    };
  }
}
