import type { Logger } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { MessagingService } from '../messaging/engine/messaging.service';

interface NotifierDeps {
  prisma: Pick<PrismaService, 'membership'>;
  messaging: Pick<MessagingService, 'send'>;
  logger: Pick<Logger, 'warn'>;
}

/**
 * Platform notice to the studio's owner about their own platform account
 * (G5c-1 trial notices, G5c-2 add-on notices). Best effort: the first ACTIVE
 * owner membership; nothing when the owner has not joined yet. TRANSACTIONAL
 * and billing EXEMPT, so it never spends the tenant's SMS credits. Returns
 * true when a new message was sent (false for a duplicate or a failure).
 */
export async function notifyStudioOwner(
  deps: NotifierDeps,
  studioId: string,
  templateKey: string,
  idempotencyKey: string,
  variables: Record<string, string | number>,
): Promise<boolean> {
  try {
    const owner = await deps.prisma.membership.findFirst({
      where: { studioId, status: 'ACTIVE', roleTemplate: { isOwner: true } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, studio: { select: { name: true } } },
    });
    if (!owner) return false;
    const result = await deps.messaging.send({
      studioId,
      recipient: { membershipId: owner.id },
      purpose: 'TRANSACTIONAL',
      templateKey,
      variables: { studioName: owner.studio.name, ...variables },
      idempotencyKey,
      billing: 'EXEMPT',
      type: templateKey,
    });
    return result.success && !result.duplicate;
  } catch (err) {
    deps.logger.warn(`Billing notice ${templateKey} for ${studioId} failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}
