import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type SocialConnection, type SocialPost } from '@platform/database';
import {
  SOCIAL_MAX_POSTS_PER_RUN,
  SOCIAL_PUBLISHING_STALE_MINUTES,
  SOCIAL_QUOTA_RETRY_MINUTES,
  isGrantedApprovalStatus,
  socialRetryDelayMs,
} from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SocialConnectionsService } from './social-connections.service';
import { mediaUrlsOf, socialPostContentHash } from './social-content-hash';
import { SocialPublishError } from './social-publisher';
import { SocialPublisherRegistry } from './social-publisher.registry';

/** What one publish attempt came to. */
export type SocialPublishOutcome =
  | { kind: 'PUBLISHED'; externalPostId: string }
  | { kind: 'QUOTA_EXHAUSTED'; nextAttemptAt: Date }
  | { kind: 'RETRYING'; nextAttemptAt: Date; error: string }
  | { kind: 'FAILED'; error: string }
  /** Not attempted: another worker holds the post, or its approval no longer counts (the post went back to DRAFT). */
  | { kind: 'SKIPPED'; reason: 'NOT_SCHEDULED' | 'APPROVAL_MISSING' | 'APPROVAL_CHANGED' | 'CONNECTION_MISSING' };

export interface SocialHeartbeatResult {
  published: number;
  retrying: number;
  deferred: number;
  failed: number;
  skipped: number;
  interrupted: number;
}

/**
 * Sends SCHEDULED social posts to their network (docs/PAZARLAMA_MODULU.md
 * 6.1, M4b). A post goes out only while it points to an APPROVED or
 * SELF_APPROVED request whose content hash still matches its content. The
 * post is claimed (SCHEDULED -> PUBLISHING) before the call so two workers
 * never send it twice; 5xx and 429 retry with backoff, 4xx ends in FAILED
 * with the reason, an used-up Instagram quota leaves the post SCHEDULED.
 * Every state change writes an AuditLog row on the post's tenant.
 */
@Injectable()
export class SocialPublishingService {
  private readonly logger = new Logger(SocialPublishingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: SocialConnectionsService,
    private readonly publishers: SocialPublisherRegistry,
  ) {}

  /** Heartbeat step: publishes due posts (at most SOCIAL_MAX_POSTS_PER_RUN) after freeing ones a crash left in PUBLISHING. */
  async processDue(now: Date): Promise<SocialHeartbeatResult> {
    const result: SocialHeartbeatResult = { published: 0, retrying: 0, deferred: 0, failed: 0, skipped: 0, interrupted: 0 };
    result.interrupted = await this.failInterrupted(now);
    const due = await this.prisma.socialPost.findMany({
      where: { status: 'SCHEDULED', scheduledAt: { lte: now }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      orderBy: { scheduledAt: 'asc' },
      take: SOCIAL_MAX_POSTS_PER_RUN,
    });
    for (const post of due) {
      let outcome: SocialPublishOutcome;
      try {
        outcome = await this.publish(post.id, now);
      } catch (err) {
        // An unexpected error must not stop the other posts; the post is left as the claim found it.
        this.logger.error(`Social post ${post.id} failed unexpectedly: ${err instanceof Error ? err.name : 'unknown'}`);
        result.failed += 1;
        continue;
      }
      if (outcome.kind === 'PUBLISHED') result.published += 1;
      else if (outcome.kind === 'RETRYING') result.retrying += 1;
      else if (outcome.kind === 'QUOTA_EXHAUSTED') result.deferred += 1;
      else if (outcome.kind === 'FAILED') result.failed += 1;
      else result.skipped += 1;
    }
    return result;
  }

  /** One attempt for one post (heartbeat and "publish now"). The post must be SCHEDULED. */
  async publish(postId: string, now: Date): Promise<SocialPublishOutcome> {
    const claimed = await this.prisma.socialPost.updateMany({ where: { id: postId, status: 'SCHEDULED' }, data: { status: 'PUBLISHING' } });
    if (claimed.count === 0) return { kind: 'SKIPPED', reason: 'NOT_SCHEDULED' };
    const post = await this.prisma.socialPost.findUniqueOrThrow({ where: { id: postId } });

    const approval = await this.approvalState(post);
    if (approval !== 'OK') {
      await this.backToDraft(post, approval, now);
      return { kind: 'SKIPPED', reason: approval };
    }
    const connection = await this.prisma.socialConnection.findFirst({ where: { id: post.connectionId, studioId: post.studioId } });
    if (!connection) {
      await this.backToDraft(post, 'CONNECTION_MISSING', now);
      return { kind: 'SKIPPED', reason: 'CONNECTION_MISSING' };
    }

    try {
      const published = await this.publishers.for(connection.provider).publish({
        externalId: connection.externalId,
        credentials: this.connections.credentialsOf(connection),
        text: post.text,
        link: post.link,
        mediaUrls: mediaUrlsOf(post.mediaUrls),
      });
      await this.markPublished(post, connection, published.externalPostId, now);
      return { kind: 'PUBLISHED', externalPostId: published.externalPostId };
    } catch (err) {
      const failure = err instanceof SocialPublishError ? err : new SocialPublishError('RETRYABLE', `Unexpected error: ${err instanceof Error ? err.name : 'unknown'}`, null);
      return this.markFailure(post, connection, failure, now);
    }
  }

  // -- Outcomes --

  private async markPublished(post: SocialPost, connection: SocialConnection, externalPostId: string, now: Date): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.socialPost.update({
        where: { id: post.id },
        data: { status: 'PUBLISHED', publishedAt: now, externalPostId, lastError: null, attemptCount: post.attemptCount + 1, nextAttemptAt: null },
      });
      if (post.calendarItemId) {
        await tx.contentCalendarItem.updateMany({ where: { id: post.calendarItemId, studioId: post.studioId, status: { not: 'CANCELLED' } }, data: { status: 'SENT' } });
      }
      await this.audit(tx, post, 'social.post.published', { provider: connection.provider, externalPostId, calendarItemId: post.calendarItemId });
    });
    await this.connections.recordOutcome(connection.id, { ok: true });
  }

  private async markFailure(post: SocialPost, connection: SocialConnection, failure: SocialPublishError, now: Date): Promise<SocialPublishOutcome> {
    if (failure.kind === 'QUOTA_EXHAUSTED') {
      // The post keeps its place and its retry budget; the quota is a rolling window, so look again later.
      const nextAttemptAt = new Date(now.getTime() + SOCIAL_QUOTA_RETRY_MINUTES * 60_000);
      await this.prisma.$transaction(async (tx) => {
        await tx.socialPost.update({ where: { id: post.id }, data: { status: 'SCHEDULED', lastError: 'SOCIAL_QUOTA_EXHAUSTED', nextAttemptAt } });
        await this.audit(tx, post, 'social.post.deferred', { provider: connection.provider, reason: 'SOCIAL_QUOTA_EXHAUSTED', nextAttemptAt: nextAttemptAt.toISOString() });
      });
      return { kind: 'QUOTA_EXHAUSTED', nextAttemptAt };
    }

    const attempts = post.attemptCount + 1;
    const delay = failure.kind === 'RETRYABLE' ? socialRetryDelayMs(attempts) : null;
    if (delay !== null) {
      const nextAttemptAt = new Date(now.getTime() + delay);
      await this.prisma.$transaction(async (tx) => {
        await tx.socialPost.update({ where: { id: post.id }, data: { status: 'SCHEDULED', lastError: failure.message, attemptCount: attempts, nextAttemptAt } });
        await this.audit(tx, post, 'social.post.retry', { provider: connection.provider, attempt: attempts, status: failure.status, nextAttemptAt: nextAttemptAt.toISOString() });
      });
      return { kind: 'RETRYING', nextAttemptAt, error: failure.message };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.socialPost.update({ where: { id: post.id }, data: { status: 'FAILED', lastError: failure.message, attemptCount: attempts, nextAttemptAt: null } });
      await this.audit(tx, post, 'social.post.failed', { provider: connection.provider, attempt: attempts, status: failure.status, retryable: failure.kind === 'RETRYABLE' });
    });
    await this.connections.recordOutcome(connection.id, { ok: false, error: failure.message, authFailure: failure.isAuthFailure });
    return { kind: 'FAILED', error: failure.message };
  }

  /** The post's request must be granted and bound to the content as it is now. */
  private async approvalState(post: SocialPost): Promise<'OK' | 'APPROVAL_MISSING' | 'APPROVAL_CHANGED'> {
    const request = post.approvalRequestId
      ? await this.prisma.approvalRequest.findFirst({ where: { id: post.approvalRequestId, studioId: post.studioId, targetType: 'SOCIAL_POST', targetId: post.id } })
      : null;
    if (!request || !isGrantedApprovalStatus(request.status)) return 'APPROVAL_MISSING';
    const hash = socialPostContentHash({
      connectionId: post.connectionId,
      text: post.text,
      mediaUrls: mediaUrlsOf(post.mediaUrls),
      link: post.link,
      scheduledAt: post.scheduledAt?.toISOString() ?? null,
    });
    return hash === request.contentHash ? 'OK' : 'APPROVAL_CHANGED';
  }

  private async backToDraft(post: SocialPost, reason: 'APPROVAL_MISSING' | 'APPROVAL_CHANGED' | 'CONNECTION_MISSING', now: Date): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.socialPost.update({ where: { id: post.id }, data: { status: 'DRAFT', lastError: `SOCIAL_${reason}` } });
      await this.audit(tx, post, 'social.post.approval_invalid', { reason, at: now.toISOString() });
    });
  }

  /** A post left in PUBLISHING by a crash may or may not have gone out: it is failed for a person to check, never sent again blindly. */
  private async failInterrupted(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - SOCIAL_PUBLISHING_STALE_MINUTES * 60_000);
    const stale = await this.prisma.socialPost.findMany({ where: { status: 'PUBLISHING', updatedAt: { lt: cutoff } }, take: 50 });
    let count = 0;
    for (const post of stale) {
      await this.prisma.$transaction(async (tx) => {
        const moved = await tx.socialPost.updateMany({
          where: { id: post.id, status: 'PUBLISHING', updatedAt: { lt: cutoff } },
          data: { status: 'FAILED', lastError: 'SOCIAL_PUBLISH_INTERRUPTED' },
        });
        if (moved.count === 0) return;
        count += 1;
        await this.audit(tx, post, 'social.post.failed', { reason: 'SOCIAL_PUBLISH_INTERRUPTED' });
      });
    }
    return count;
  }

  private async audit(tx: Prisma.TransactionClient, post: SocialPost, action: string, metadata: Record<string, unknown>): Promise<void> {
    await tx.auditLog.create({
      data: { studioId: post.studioId, userId: null, action, entityType: 'SocialPost', entityId: post.id, metadata: metadata as Prisma.InputJsonValue },
    });
  }
}
