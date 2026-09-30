import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingService } from '../messaging/engine/messaging.service';

/**
 * E-mail delivery of error alerts through the messaging engine
 * (TRANSACTIONAL templates ERROR_*, e-mail only): to every active super admin
 * with an address, and, for the opt-in tenant notice, to a studio's owner.
 */
@Injectable()
export class ErrorAlertMailer {
  private readonly logger = new Logger(ErrorAlertMailer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
  ) {}

  /** Returns how many super admins the engine accepted the email for. */
  async sendToSuperAdmins(templateKey: string, variables: Record<string, string | number>): Promise<number> {
    const admins = await this.prisma.user.findMany({
      where: { isSuperAdmin: true, isActive: true, email: { not: null } },
      select: { id: true },
    });
    let accepted = 0;
    for (const admin of admins) {
      try {
        const result = await this.messaging.send({
          studioId: null,
          recipient: { userId: admin.id },
          channel: 'EMAIL',
          purpose: 'TRANSACTIONAL',
          templateKey,
          variables,
          type: templateKey,
          billing: 'EXEMPT',
        });
        if (result.success) accepted++;
      } catch (err) {
        this.logger.warn(`Error alert ${templateKey} could not be sent: ${err instanceof Error ? err.name : 'unknown'}`);
      }
    }
    return accepted;
  }

  /** E-mail to the studio's first active owner; false when there is none or the engine refused. */
  async sendToOwner(studioId: string, templateKey: string, variables: Record<string, string | number>): Promise<boolean> {
    try {
      const owner = await this.prisma.membership.findFirst({
        where: { studioId, status: 'ACTIVE', roleTemplate: { isOwner: true } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, studio: { select: { name: true } } },
      });
      if (!owner) return false;
      const result = await this.messaging.send({
        studioId,
        recipient: { membershipId: owner.id },
        channel: 'EMAIL',
        purpose: 'TRANSACTIONAL',
        templateKey,
        variables: { studioName: owner.studio.name, ...variables },
        type: templateKey,
        billing: 'EXEMPT',
      });
      return result.success;
    } catch (err) {
      this.logger.warn(`Error notice ${templateKey} could not be sent: ${err instanceof Error ? err.name : 'unknown'}`);
      return false;
    }
  }
}
