import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ContactConsent, CommunicationConsent, NotificationChannel } from '@platform/database';
import { CONTACT_CONSENT_CHANNELS, complianceRegionOf, countryOfPhone } from '@platform/shared';
import type { ConsentChannelName, ContactConsentChannel, ContactConsentDTO, UpdateContactConsentInput } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { IysClientAdapter } from './iys-client.adapter';

type ConsentRow = Pick<ContactConsent | CommunicationConsent, 'status' | 'grantedAt' | 'revokedAt' | 'updatedAt'>;

/** When the row's current status was decided. */
function decidedAt(row: ConsentRow): number {
  const at = row.status === 'GRANTED' ? row.grantedAt : row.revokedAt;
  return (at ?? row.updatedAt).getTime();
}

/**
 * Merges the contact's own consent row with the member's CommunicationConsent
 * row (when the contact has an account): the most recent decision wins, so
 * a lead who agreed on a form and later revoked in the member app (or the
 * other way round) is treated by what they said last. No row at all means
 * no consent.
 */
export function effectiveConsent(contactRow: ConsentRow | null, memberRow: ConsentRow | null): { granted: boolean; decidedBy: 'contact' | 'member' | 'default' } {
  if (!contactRow && !memberRow) return { granted: false, decidedBy: 'default' };
  if (contactRow && (!memberRow || decidedAt(contactRow) >= decidedAt(memberRow))) {
    return { granted: contactRow.status === 'GRANTED', decidedBy: 'contact' };
  }
  return { granted: memberRow!.status === 'GRANTED', decidedBy: 'member' };
}

/**
 * Contact-level commercial consent (G2a, docs/KAMPANYA_VE_AKISLAR.md). The
 * messaging engine asks isGranted() before every commercial message; staff
 * record consent on the contact card; unsubscribe links and STOP keywords
 * revoke it. Changes for Turkish recipients are pushed to İYS (the same
 * adapter the member-level ConsentService uses); elsewhere there is no
 * national registry and the row is marked as needing no sync.
 */
@Injectable()
export class ContactConsentService {
  private readonly logger = new Logger(ContactConsentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly iys: IysClientAdapter,
  ) {}

  /** Commercial send gate for one channel (IN_APP and PUSH are decided by the caller). */
  async isGranted(studioId: string, contactId: string | null, userId: string | null, channel: ConsentChannelName): Promise<boolean> {
    const [contactRow, memberRow] = await Promise.all([
      contactId ? this.prisma.contactConsent.findFirst({ where: { studioId, contactId, channel } }) : Promise.resolve(null),
      userId ? this.prisma.communicationConsent.findUnique({ where: { studioId_userId_channel: { studioId, userId, channel } } }) : Promise.resolve(null),
    ]);
    return effectiveConsent(contactRow, memberRow).granted;
  }

  async listForContact(studioId: string, contactId: string): Promise<ContactConsentDTO[]> {
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, studioId, mergedIntoId: null },
      select: { id: true, phone: true, email: true, membership: { select: { userId: true, user: { select: { phone: true, email: true } } } } },
    });
    if (!contact) throw new NotFoundException('Kişi bulunamadı');
    const userId = contact.membership?.userId ?? null;
    const [rows, memberRows] = await Promise.all([
      this.prisma.contactConsent.findMany({ where: { studioId, contactId } }),
      userId ? this.prisma.communicationConsent.findMany({ where: { studioId, userId } }) : Promise.resolve([] as CommunicationConsent[]),
    ]);
    const phone = contact.phone ?? contact.membership?.user.phone ?? null;
    const email = contact.email ?? contact.membership?.user.email ?? null;
    const addresses: Partial<Record<NotificationChannel, string>> = {};
    if (phone) {
      addresses.SMS = phone;
      addresses.WHATSAPP = phone;
    }
    if (email) addresses.EMAIL = email.trim().toLowerCase();
    const suppressions = await this.prisma.messageSuppression.findMany({
      where: {
        studioId,
        OR: (Object.entries(addresses) as [NotificationChannel, string][]).map(([channel, address]) => ({ channel, address })),
      },
      select: { channel: true },
    });
    const suppressed = new Set(suppressions.map((s) => s.channel));

    return CONTACT_CONSENT_CHANNELS.map((channel) => {
      const own = rows.find((r) => r.channel === channel) ?? null;
      const member = memberRows.find((r) => r.channel === channel) ?? null;
      const decision = effectiveConsent(own, member);
      const decider = decision.decidedBy === 'contact' ? own : decision.decidedBy === 'member' ? member : null;
      return {
        channel,
        status: decision.granted ? 'GRANTED' : 'REVOKED',
        decidedBy: decision.decidedBy,
        source: decider?.source ?? null,
        evidence: decision.decidedBy === 'contact' ? (own?.evidence ?? null) : null,
        grantedAt: decider?.grantedAt?.toISOString() ?? null,
        revokedAt: decider?.revokedAt?.toISOString() ?? null,
        suppressed: suppressed.has(channel),
      };
    });
  }

  /** Staff or a web form records a decision on one channel. */
  async set(studioId: string, contactId: string, input: UpdateContactConsentInput, source = 'staff-entry'): Promise<ContactConsentDTO[]> {
    const contact = await this.prisma.contact.findFirst({ where: { id: contactId, studioId, mergedIntoId: null }, select: { id: true } });
    if (!contact) throw new NotFoundException('Kişi bulunamadı');
    await this.write(studioId, contactId, input.channel, input.granted ? 'GRANTED' : 'REVOKED', source, input.evidence ?? null);
    return this.listForContact(studioId, contactId);
  }

  /**
   * Opt-out outside the card (unsubscribe link, STOP keyword). Idempotent.
   * `registryHandled`: the member-level revocation already reports to İYS
   * for the same person, so this row is not pushed a second time.
   */
  async revoke(studioId: string, contactId: string, channel: ContactConsentChannel, source: string, opts: { registryHandled?: boolean } = {}): Promise<void> {
    const existing = await this.prisma.contactConsent.findFirst({ where: { studioId, contactId, channel } });
    if (existing?.status === 'REVOKED') return;
    await this.write(studioId, contactId, channel, 'REVOKED', source, null, opts.registryHandled);
  }

  private async write(
    studioId: string,
    contactId: string,
    channel: ContactConsentChannel,
    status: 'GRANTED' | 'REVOKED',
    source: string,
    evidence: string | null,
    registryHandled = false,
  ): Promise<void> {
    const now = new Date();
    const row = await this.prisma.contactConsent.upsert({
      where: { contactId_channel: { contactId, channel } },
      create: {
        studioId,
        contactId,
        channel,
        status,
        source,
        evidence,
        grantedAt: status === 'GRANTED' ? now : null,
        revokedAt: status === 'REVOKED' ? now : null,
        iysSyncedAt: registryHandled ? now : null,
      },
      update: {
        status,
        source,
        evidence,
        grantedAt: status === 'GRANTED' ? now : undefined,
        revokedAt: status === 'REVOKED' ? now : null,
        iysSyncedAt: registryHandled ? now : null,
      },
    });
    if (!registryHandled) {
      // Best effort now; syncPending() retries on the heartbeat.
      await this.syncOne(row.id).catch((err: Error) => this.logger.warn(`Contact consent registry sync failed: ${err.message}`));
    }
  }

  private async syncOne(id: string): Promise<boolean> {
    const row = await this.prisma.contactConsent.findUnique({
      where: { id },
      include: { contact: { select: { phone: true, email: true, countryCode: true } }, studio: { select: { countryCode: true } } },
    });
    if (!row || row.iysSyncedAt) return true;
    const phone = row.contact.phone;
    const region = complianceRegionOf(row.contact.countryCode ?? countryOfPhone(phone) ?? row.studio.countryCode);
    const recipient = row.channel === 'EMAIL' ? row.contact.email?.trim().toLowerCase() : phone;
    if (region !== 'TR' || !recipient) {
      // No national consent registry for this recipient: nothing to push.
      await this.prisma.contactConsent.update({ where: { id }, data: { iysSyncedAt: new Date() } });
      return true;
    }
    const result = await this.iys.syncConsent({
      recipient,
      channel: row.channel,
      type: row.status,
      at: ((row.status === 'GRANTED' ? row.grantedAt : row.revokedAt) ?? row.updatedAt).toISOString(),
    });
    if (result.success) await this.prisma.contactConsent.update({ where: { id }, data: { iysSyncedAt: new Date() } });
    return result.success;
  }

  /** Heartbeat: pushes every contact consent change not yet reported. */
  async syncPending(): Promise<{ synced: number; failed: number }> {
    const pending = await this.prisma.contactConsent.findMany({ where: { iysSyncedAt: null }, select: { id: true }, take: 500 });
    let synced = 0;
    let failed = 0;
    for (const row of pending) {
      if (await this.syncOne(row.id).catch(() => false)) synced += 1;
      else failed += 1;
    }
    return { synced, failed };
  }
}
