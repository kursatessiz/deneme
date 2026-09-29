import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@platform/database';
import type { NotificationChannel, SuppressionReason } from '@platform/database';
import { complianceRegionOf } from '@platform/shared';
import type { ConsentChannelName } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ConsentService } from '../../notifications/consent/consent.service';
import { ContactConsentService } from '../../notifications/consent/contact-consent.service';
import { IysClientAdapter } from '../../notifications/consent/iys-client.adapter';

const CONSENT_CHANNELS: readonly NotificationChannel[] = ['SMS', 'WHATSAPP', 'EMAIL'];

export function normalizeAddress(channel: NotificationChannel, address: string): string {
  return channel === 'EMAIL' ? address.trim().toLowerCase() : address.trim();
}

export interface OptOutInput {
  studioId: string;
  channel: NotificationChannel;
  address: string;
  reason: SuppressionReason;
  contactId?: string | null;
  userId?: string | null;
  notificationLogId?: string | null;
  /** Recipient country; TR routes the revocation through İYS. */
  countryCode?: string | null;
  /** CommunicationConsent.source for the revocation. */
  source: string;
}

/**
 * The address-level suppression list plus the consent store (compliance):
 * an unsubscribe, STOP keyword, hard bounce or complaint suppresses every
 * future COMMERCIAL message on that channel to that address. Explicit
 * opt-outs (unsubscribe, STOP) also revoke the member's recorded consent
 * and the contact's own consent (G2a), which are pushed to İYS for TR; an
 * address with neither an account nor a contact is reported directly.
 */
@Injectable()
export class OptOutService {
  private readonly logger = new Logger(OptOutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly consents: ConsentService,
    private readonly iys: IysClientAdapter,
    private readonly contactConsents: ContactConsentService,
  ) {}

  async isSuppressed(studioId: string, channel: NotificationChannel, address: string | null): Promise<boolean> {
    if (!address) return false;
    const row = await this.prisma.messageSuppression.findUnique({
      where: { studioId_channel_address: { studioId, channel, address: normalizeAddress(channel, address) } },
      select: { id: true },
    });
    return Boolean(row);
  }

  /** Adds the address to the suppression list. Returns false when it already was there (idempotent). */
  async suppress(input: Omit<OptOutInput, 'source' | 'userId' | 'countryCode'>): Promise<boolean> {
    const address = normalizeAddress(input.channel, input.address);
    try {
      await this.prisma.messageSuppression.create({
        data: {
          studioId: input.studioId,
          channel: input.channel,
          address,
          reason: input.reason,
          contactId: input.contactId ?? null,
          notificationLogId: input.notificationLogId ?? null,
        },
      });
      return true;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false;
      throw err;
    }
  }

  /** Suppression plus consent revocation (İYS for TR). Returns false when already opted out. */
  async optOut(input: OptOutInput): Promise<boolean> {
    const created = await this.suppress(input);
    if (!CONSENT_CHANNELS.includes(input.channel)) return created;
    const channel = input.channel as ConsentChannelName;
    if (input.userId) {
      await this.consents.revoke(input.studioId, input.userId, channel, input.source);
    }
    if (input.contactId && channel !== 'CALL') {
      // Contact-level consent (G2a) is revoked too; its İYS push is skipped
      // when the member-level revocation above already reports this person.
      await this.contactConsents.revoke(input.studioId, input.contactId, channel, input.source, { registryHandled: Boolean(input.userId) });
    } else if (!input.userId && created && complianceRegionOf(input.countryCode) === 'TR') {
      const result = await this.iys.syncConsent({
        recipient: normalizeAddress(input.channel, input.address),
        channel,
        type: 'REVOKED',
        at: new Date().toISOString(),
      });
      if (!result.success) this.logger.warn(`İYS revocation failed for a contact without an account: ${result.errorMessage ?? 'unknown'}`);
    }
    return created;
  }
}
