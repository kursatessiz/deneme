import { Injectable, Logger } from '@nestjs/common';
import type { CommunicationConsentDTO, ConsentChannelName, UpdateConsentInput } from '@platform/shared';
import { CONSENT_CHANNELS } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { IysClientAdapter } from './iys-client.adapter';

@Injectable()
export class ConsentService {
  private readonly logger = new Logger(ConsentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly iys: IysClientAdapter,
  ) {}

  /** All channels for a user in a studio, defaulting to REVOKED (no opt-in on record). */
  async listForUser(studioId: string, userId: string): Promise<CommunicationConsentDTO[]> {
    const rows = await this.prisma.communicationConsent.findMany({ where: { studioId, userId } });
    return CONSENT_CHANNELS.map((channel) => {
      const row = rows.find((r) => r.channel === channel);
      return {
        channel,
        status: row?.status ?? 'REVOKED',
        source: row?.source ?? 'default',
        grantedAt: row?.grantedAt?.toISOString() ?? null,
        revokedAt: row?.revokedAt?.toISOString() ?? null,
      };
    });
  }

  /** Whether a GRANTED consent is on record for this channel (commercial send gate). */
  async isGranted(studioId: string, userId: string, channel: ConsentChannelName): Promise<boolean> {
    const row = await this.prisma.communicationConsent.findUnique({
      where: { studioId_userId_channel: { studioId, userId, channel } },
    });
    return row?.status === 'GRANTED';
  }

  /** Member self-service: grant or revoke one channel. Revocation is immediate. */
  async setOwn(studioId: string, userId: string, input: UpdateConsentInput): Promise<CommunicationConsentDTO[]> {
    const now = new Date();
    await this.prisma.communicationConsent.upsert({
      where: { studioId_userId_channel: { studioId, userId, channel: input.channel } },
      create: {
        studioId,
        userId,
        channel: input.channel,
        status: input.granted ? 'GRANTED' : 'REVOKED',
        source: 'member-app',
        grantedAt: input.granted ? now : null,
        revokedAt: input.granted ? null : now,
      },
      update: {
        status: input.granted ? 'GRANTED' : 'REVOKED',
        grantedAt: input.granted ? now : undefined,
        revokedAt: input.granted ? null : now,
        iysSyncedAt: null,
      },
    });
    // Fire-and-forget style sync: queued for syncPendingConsents() too, so a
    // transient İYS outage never blocks the member's own request.
    this.syncOne(studioId, userId, input.channel).catch((err) =>
      this.logger.error(`Consent sync failed for ${studioId}/${userId}/${input.channel}: ${err.message}`),
    );
    return this.listForUser(studioId, userId);
  }

  /** Staff view: every member's consent state for the studio (for export/audit). */
  async listForStudio(studioId: string) {
    const rows = await this.prisma.communicationConsent.findMany({
      where: { studioId },
      include: { user: { select: { id: true, firstName: true, lastName: true, phone: true } } },
      orderBy: [{ userId: 'asc' }, { channel: 'asc' }],
    });
    return rows.map((r) => ({
      userId: r.userId,
      fullName: `${r.user.firstName} ${r.user.lastName}`,
      phone: r.user.phone,
      channel: r.channel,
      status: r.status,
      source: r.source,
      grantedAt: r.grantedAt,
      revokedAt: r.revokedAt,
      iysSyncedAt: r.iysSyncedAt,
    }));
  }

  private async syncOne(studioId: string, userId: string, channel: ConsentChannelName): Promise<void> {
    const row = await this.prisma.communicationConsent.findUnique({
      where: { studioId_userId_channel: { studioId, userId, channel } },
      include: { user: { select: { phone: true } } },
    });
    if (!row) return;
    const result = await this.iys.syncConsent({
      recipient: row.user.phone,
      channel: row.channel,
      type: row.status,
      at: (row.status === 'GRANTED' ? row.grantedAt : row.revokedAt)?.toISOString() ?? new Date().toISOString(),
    });
    if (result.success) {
      await this.prisma.communicationConsent.update({ where: { id: row.id }, data: { iysSyncedAt: new Date() } });
    }
  }

  /** Batch-syncs every consent row not yet pushed to İYS. Meant for a scheduled job. */
  async syncPendingConsents(): Promise<{ synced: number; failed: number }> {
    const pending = await this.prisma.communicationConsent.findMany({
      where: { iysSyncedAt: null },
      include: { user: { select: { phone: true } } },
      take: 500,
    });
    let synced = 0;
    let failed = 0;
    for (const row of pending) {
      const result = await this.iys.syncConsent({
        recipient: row.user.phone,
        channel: row.channel,
        type: row.status,
        at: (row.status === 'GRANTED' ? row.grantedAt : row.revokedAt)?.toISOString() ?? new Date().toISOString(),
      });
      if (result.success) {
        await this.prisma.communicationConsent.update({ where: { id: row.id }, data: { iysSyncedAt: new Date() } });
        synced += 1;
      } else {
        failed += 1;
        this.logger.warn(`IYS sync failed for consent ${row.id}: ${result.errorMessage}`);
      }
    }
    return { synced, failed };
  }
}
