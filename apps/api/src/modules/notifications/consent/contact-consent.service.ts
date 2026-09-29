import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@platform/database';
import type { CommunicationConsent, ConsentLegalBasis, ContactConsent } from '@platform/database';
import {
  CONTACT_CONSENT_CHANNELS,
  DEFAULT_DOUBLE_OPT_IN_REGIONS,
  REGION_CONSENT_RULES,
  complianceRegionOf,
  countryOfPhone,
  requiresDoubleOptIn,
} from '@platform/shared';
import type {
  ConsentChannelName,
  ConsentFacts,
  ConsentPolicy,
  ContactConsentChannel,
  ContactConsentDTO,
  UpdateContactConsentInput,
} from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { IysClientAdapter } from './iys-client.adapter';

type ConsentRow = Pick<ContactConsent | CommunicationConsent, 'status' | 'grantedAt' | 'revokedAt' | 'updatedAt'>;
type ContactRowFacts = Pick<ContactConsent, 'status' | 'grantedAt' | 'revokedAt' | 'updatedAt' | 'legalBasis' | 'confirmedAt' | 'confirmationRequestedAt'>;

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

/** Contact columns the eligibility batch reads. */
export const ELIGIBILITY_CONTACT_SELECT = {
  id: true,
  phone: true,
  email: true,
  isBusiness: true,
  membership: { select: { status: true, user: { select: { id: true, phone: true, email: true } } } },
} satisfies Prisma.ContactSelect;

/** Double opt-in requested at capture and not yet clicked. */
export function isConfirmationPending(row: Pick<ContactConsent, 'status' | 'confirmedAt' | 'confirmationRequestedAt'>): boolean {
  return row.status === 'GRANTED' && row.confirmationRequestedAt !== null && row.confirmedAt === null;
}

/** The facts evaluateCommercialEligibility needs about the recorded decision for one channel. */
export function consentFactsOf(contactRow: ContactRowFacts | null, memberRow: ConsentRow | null): ConsentFacts {
  const decision = effectiveConsent(contactRow, memberRow);
  if (decision.decidedBy === 'default') {
    return { decision: 'NONE', decidedBy: 'default', legalBasis: null, confirmationRequested: false, confirmed: false };
  }
  const own = decision.decidedBy === 'contact' ? contactRow : null;
  return {
    decision: decision.granted ? 'GRANTED' : 'REVOKED',
    decidedBy: decision.decidedBy,
    legalBasis: own?.legalBasis ?? null,
    confirmationRequested: own?.confirmationRequestedAt != null,
    confirmed: own?.confirmedAt != null,
  };
}

function regionList(raw: Prisma.JsonValue | null | undefined): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [...DEFAULT_DOUBLE_OPT_IN_REGIONS];
}

/** A contact as the eligibility batch needs it. */
export interface EligibilityContact {
  id: string;
  phone: string | null;
  email: string | null;
  isBusiness: boolean;
  membership: { status: string; user: { id: string; phone: string | null; email: string | null } } | null;
}

/**
 * Consent facts for a batch of contacts of one tenant: the recorded
 * decision per channel, the business flag and whether the contact is an
 * existing customer (an active membership of the tenant or, on the
 * platform tenant, the owner of a paying studio).
 */
export class ConsentBatch {
  constructor(
    readonly policy: ConsentPolicy | null,
    private readonly contactRows: ContactConsent[],
    private readonly memberRows: CommunicationConsent[],
    private readonly customers: ReadonlySet<string>,
    private readonly businesses: ReadonlySet<string>,
  ) {}

  facts(contactId: string, userId: string | null, channel: ContactConsentChannel): ConsentFacts {
    const own = this.contactRows.find((r) => r.contactId === contactId && r.channel === channel) ?? null;
    const member = userId ? (this.memberRows.find((r) => r.userId === userId && r.channel === channel) ?? null) : null;
    return consentFactsOf(own, member);
  }

  isExistingCustomer(contactId: string): boolean {
    return this.customers.has(contactId);
  }

  isBusiness(contactId: string): boolean {
    return this.businesses.has(contactId);
  }
}

/** Everything the compliance engine needs to decide one commercial message on one channel. */
export interface CommercialConsentFacts {
  policy: ConsentPolicy | null;
  consent: ConsentFacts;
  isBusiness: boolean;
  isExistingCustomer: boolean;
}

/** Source of consent rows written by the TR merchant exemption. */
export const MERCHANT_EXEMPTION_SOURCE = 'tr-merchant-exemption';

/**
 * Contact-level commercial consent (G2a, docs/KAMPANYA_VE_AKISLAR.md; M3e
 * legal basis and double opt-in, docs/PAZARLAMA_MODULU.md 6.4). The
 * messaging engine asks commercialFacts() before every commercial message
 * and ComplianceService decides with the shared rule set; staff record
 * consent on the contact card; web forms record it as CONSENT (pending
 * until confirmed in a double opt-in region); unsubscribe links and STOP
 * keywords revoke it. Every change is written to the contact's activity
 * trail (type CONSENT). Changes for Turkish recipients are pushed to İYS
 * (the same adapter the member-level ConsentService uses); elsewhere there
 * is no national registry and the row is marked as needing no sync.
 */
@Injectable()
export class ContactConsentService {
  private readonly logger = new Logger(ContactConsentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly iys: IysClientAdapter,
  ) {}

  /**
   * The tenant's consent policy: its MarketingSettings row, or the defaults
   * on the platform tenant. Null for every other tenant without a row, so
   * their behaviour is exactly as before M3e.
   */
  async policyFor(studioId: string): Promise<ConsentPolicy | null> {
    const [row, studio] = await Promise.all([
      this.prisma.marketingSettings.findUnique({ where: { studioId }, select: { doubleOptInRegions: true, trMerchantExemptionEnabled: true } }),
      this.prisma.studio.findUnique({ where: { id: studioId }, select: { isPlatform: true } }),
    ]);
    if (row) return { doubleOptInRegions: regionList(row.doubleOptInRegions), trMerchantExemptionEnabled: row.trMerchantExemptionEnabled };
    if (studio?.isPlatform) return { doubleOptInRegions: [...DEFAULT_DOUBLE_OPT_IN_REGIONS], trMerchantExemptionEnabled: false };
    return null;
  }

  /** Commercial send gate before M3e: a recorded, granted decision (kept for callers that only need the flag). */
  async isGranted(studioId: string, contactId: string | null, userId: string | null, channel: ConsentChannelName): Promise<boolean> {
    const [contactRow, memberRow] = await Promise.all([
      contactId ? this.prisma.contactConsent.findFirst({ where: { studioId, contactId, channel } }) : Promise.resolve(null),
      userId ? this.prisma.communicationConsent.findUnique({ where: { studioId_userId_channel: { studioId, userId, channel } } }) : Promise.resolve(null),
    ]);
    return effectiveConsent(contactRow, memberRow).granted;
  }

  /** Facts for one recipient and channel (the messaging engine, per attempt). */
  async commercialFacts(studioId: string, contactId: string | null, userId: string | null, channel: ContactConsentChannel): Promise<CommercialConsentFacts> {
    const policy = await this.policyFor(studioId);
    if (contactId) {
      const contact = await this.prisma.contact.findFirst({ where: { id: contactId, studioId }, select: ELIGIBILITY_CONTACT_SELECT });
      if (contact) {
        const batch = await this.batch(studioId, [contact], policy);
        const ownUserId = userId ?? contact.membership?.user.id ?? null;
        return {
          policy,
          consent: batch.facts(contact.id, ownUserId, channel),
          isBusiness: batch.isBusiness(contact.id),
          isExistingCustomer: batch.isExistingCustomer(contact.id),
        };
      }
    }
    const memberRow = userId ? await this.prisma.communicationConsent.findUnique({ where: { studioId_userId_channel: { studioId, userId, channel } } }) : null;
    const activeMember = userId ? (await this.prisma.membership.count({ where: { studioId, userId, status: 'ACTIVE' } })) > 0 : false;
    return { policy, consent: consentFactsOf(null, memberRow), isBusiness: false, isExistingCustomer: activeMember };
  }

  /** Facts for many contacts of one tenant (campaign precheck, merchant exemption backfill). */
  async batch(studioId: string, contacts: readonly EligibilityContact[], policy?: ConsentPolicy | null): Promise<ConsentBatch> {
    const resolvedPolicy = policy === undefined ? await this.policyFor(studioId) : policy;
    const ids = contacts.map((c) => c.id);
    const userIds = contacts.map((c) => c.membership?.user.id).filter((v): v is string => Boolean(v));
    const [contactRows, memberRows, studio] = await Promise.all([
      ids.length ? this.prisma.contactConsent.findMany({ where: { studioId, contactId: { in: ids } } }) : Promise.resolve([] as ContactConsent[]),
      userIds.length ? this.prisma.communicationConsent.findMany({ where: { studioId, userId: { in: userIds } } }) : Promise.resolve([] as CommunicationConsent[]),
      this.prisma.studio.findUnique({ where: { id: studioId }, select: { isPlatform: true } }),
    ]);
    const customers = new Set(contacts.filter((c) => c.membership?.status === 'ACTIVE').map((c) => c.id));
    if (studio?.isPlatform && resolvedPolicy) {
      for (const id of await this.payingOwnerContacts(contacts)) customers.add(id);
    }
    const businesses = new Set(contacts.filter((c) => c.isBusiness).map((c) => c.id));
    return new ConsentBatch(resolvedPolicy, contactRows, memberRows, customers, businesses);
  }

  /** Platform tenant: contacts whose phone or e-mail is the owner of a paying (ACTIVE billing) studio. */
  private async payingOwnerContacts(contacts: readonly EligibilityContact[]): Promise<string[]> {
    const phones = new Set<string>();
    const emails = new Set<string>();
    for (const c of contacts) {
      for (const p of [c.phone, c.membership?.user.phone]) if (p) phones.add(p);
      for (const e of [c.email, c.membership?.user.email]) if (e) emails.add(e.trim().toLowerCase());
    }
    if (!phones.size && !emails.size) return [];
    const owners = await this.prisma.membership.findMany({
      where: {
        status: 'ACTIVE',
        roleTemplate: { isOwner: true },
        studio: { isPlatform: false, billingStatus: 'ACTIVE' },
        user: { OR: [{ phone: { in: [...phones] } }, ...(emails.size ? [{ email: { in: [...emails] } }] : [])] },
      },
      select: { user: { select: { phone: true, email: true } } },
    });
    const ownerPhones = new Set(owners.map((o) => o.user.phone));
    const ownerEmails = new Set(owners.map((o) => o.user.email?.trim().toLowerCase()).filter((e): e is string => Boolean(e)));
    return contacts
      .filter((c) => {
        const cp = [c.phone, c.membership?.user.phone].filter((p): p is string => Boolean(p));
        const ce = [c.email, c.membership?.user.email].filter((e): e is string => Boolean(e)).map((e) => e.trim().toLowerCase());
        return cp.some((p) => ownerPhones.has(p)) || ce.some((e) => ownerEmails.has(e));
      })
      .map((c) => c.id);
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
    const addresses: Partial<Record<ContactConsentChannel, string>> = {};
    if (phone) {
      addresses.SMS = phone;
      addresses.WHATSAPP = phone;
    }
    if (email) addresses.EMAIL = email.trim().toLowerCase();
    const suppressions = await this.prisma.messageSuppression.findMany({
      where: {
        studioId,
        OR: (Object.entries(addresses) as [ContactConsentChannel, string][]).map(([channel, address]) => ({ channel, address })),
      },
      select: { channel: true },
    });
    const suppressed = new Set<string>(suppressions.map((s) => s.channel));

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
        legalBasis: own ? (own.legalBasis ?? 'CONSENT') : null,
        confirmationPending: own ? isConfirmationPending(own) : false,
        confirmedAt: own?.confirmedAt?.toISOString() ?? null,
        formVersion: own?.formVersion ?? null,
      };
    });
  }

  /**
   * Staff record a decision on one channel. A granted consent with written
   * evidence is an explicit consent obtained outside the form, so it does
   * not wait for a double opt-in confirmation.
   */
  async set(studioId: string, contactId: string, input: UpdateContactConsentInput, source = 'staff-entry'): Promise<ContactConsentDTO[]> {
    const contact = await this.prisma.contact.findFirst({ where: { id: contactId, studioId, mergedIntoId: null }, select: { id: true } });
    if (!contact) throw new NotFoundException('Kişi bulunamadı');
    await this.write(studioId, contactId, input.channel, input.granted ? 'GRANTED' : 'REVOKED', source, input.evidence ?? null, {
      legalBasis: 'CONSENT',
      confirmationRequestedAt: null,
    });
    return this.listForContact(studioId, contactId);
  }

  /**
   * A web form consent (M3e). In a double opt-in region of the tenant's
   * policy the row is CONSENT with a requested, unconfirmed confirmation
   * and does not count until the link is clicked. A consent that already
   * counts is not downgraded; a pending one stays pending. Returns the
   * rows that now wait for a confirmation e-mail.
   */
  async recordFormConsent(
    studioId: string,
    contactId: string,
    input: { channels: readonly ContactConsentChannel[]; formVersion: string | null; countryCode: string | null },
  ): Promise<{ pendingConsentIds: string[]; doubleOptIn: boolean }> {
    const policy = await this.policyFor(studioId);
    const doubleOptIn = policy ? requiresDoubleOptIn(policy.doubleOptInRegions, input.countryCode) : false;
    const pendingConsentIds: string[] = [];
    for (const channel of input.channels) {
      const existing = await this.prisma.contactConsent.findUnique({ where: { contactId_channel: { contactId, channel } } });
      if (existing && existing.studioId !== studioId) continue;
      if (existing?.status === 'GRANTED') {
        if (isConfirmationPending(existing)) pendingConsentIds.push(existing.id);
        continue;
      }
      const row = await this.write(studioId, contactId, channel, 'GRANTED', 'web-form', null, {
        legalBasis: 'CONSENT',
        formVersion: input.formVersion,
        confirmationRequestedAt: doubleOptIn ? new Date() : null,
        confirmedAt: null,
      });
      if (doubleOptIn) pendingConsentIds.push(row.id);
    }
    return { pendingConsentIds, doubleOptIn };
  }

  /**
   * Marks every pending consent of the contact as confirmed (the link
   * confirms the consent given on the form; one e-mail covers the SMS
   * consent given together with it). Only the time is recorded.
   */
  async markConfirmed(studioId: string, contactId: string, at: Date, tx: Prisma.TransactionClient): Promise<number> {
    const pending = await tx.contactConsent.findMany({
      where: { studioId, contactId, status: 'GRANTED', confirmationRequestedAt: { not: null }, confirmedAt: null },
      select: { id: true, channel: true, legalBasis: true, formVersion: true },
    });
    if (!pending.length) return 0;
    await tx.contactConsent.updateMany({ where: { id: { in: pending.map((p) => p.id) } }, data: { confirmedAt: at, iysSyncedAt: null } });
    await tx.contactActivity.createMany({
      data: pending.map((p) => ({
        studioId,
        contactId,
        type: 'CONSENT',
        body: `${p.channel} CONFIRMED ${p.legalBasis ?? 'CONSENT'}`,
        metadata: { event: 'double_opt_in_confirmed', channel: p.channel, legalBasis: p.legalBasis ?? 'CONSENT', formVersion: p.formVersion, confirmedAt: at.toISOString() },
      })),
    });
    return pending.length;
  }

  /** After a confirmation commits: push the now-valid consents to the registry where one applies. */
  async syncContact(studioId: string, contactId: string): Promise<void> {
    const rows = await this.prisma.contactConsent.findMany({ where: { studioId, contactId, iysSyncedAt: null }, select: { id: true } });
    for (const row of rows) await this.syncOne(row.id).catch((err: Error) => this.logger.warn(`Contact consent registry sync failed: ${err.message}`));
  }

  /**
   * TR merchant exemption (M3e): records a TR_MERCHANT_EXEMPTION consent
   * for a business contact in an exemption region on every channel it has
   * an address for and no decision yet, and registers it with İYS as a
   * merchant. Never overrides a recorded decision (a revocation stays).
   * Returns the number of rows written.
   */
  async applyMerchantExemption(studioId: string, contactId: string): Promise<number> {
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, studioId, mergedIntoId: null, isBusiness: true },
      select: { id: true, phone: true, email: true, countryCode: true, studio: { select: { countryCode: true } } },
    });
    if (!contact) return 0;
    const region = complianceRegionOf(contact.countryCode ?? countryOfPhone(contact.phone) ?? contact.studio.countryCode);
    if (!REGION_CONSENT_RULES[region].merchantExemption) return 0;
    const channels: ContactConsentChannel[] = [...(contact.email ? (['EMAIL'] as const) : []), ...(contact.phone ? (['SMS', 'WHATSAPP'] as const) : [])];
    const existing = await this.prisma.contactConsent.findMany({ where: { contactId, channel: { in: channels } }, select: { channel: true } });
    const taken = new Set<string>(existing.map((r) => r.channel));
    let written = 0;
    for (const channel of channels) {
      if (taken.has(channel)) continue;
      await this.write(studioId, contactId, channel, 'GRANTED', MERCHANT_EXEMPTION_SOURCE, null, { legalBasis: 'TR_MERCHANT_EXEMPTION', confirmationRequestedAt: null });
      written += 1;
    }
    return written;
  }

  /** Backfill after the exemption is switched on: every business contact of the tenant. */
  async applyMerchantExemptionToAll(studioId: string): Promise<number> {
    const contacts = await this.prisma.contact.findMany({ where: { studioId, isBusiness: true, mergedIntoId: null }, select: { id: true }, take: 5000 });
    let written = 0;
    for (const c of contacts) written += await this.applyMerchantExemption(studioId, c.id);
    return written;
  }

  /**
   * Opt-out outside the card (unsubscribe link, STOP keyword). Idempotent.
   * `registryHandled`: the member-level revocation already reports to İYS
   * for the same person, so this row is not pushed a second time.
   */
  async revoke(studioId: string, contactId: string, channel: ContactConsentChannel, source: string, opts: { registryHandled?: boolean } = {}): Promise<void> {
    const existing = await this.prisma.contactConsent.findFirst({ where: { studioId, contactId, channel } });
    if (existing?.status === 'REVOKED') return;
    await this.write(studioId, contactId, channel, 'REVOKED', source, null, {}, opts.registryHandled);
  }

  private async write(
    studioId: string,
    contactId: string,
    channel: ContactConsentChannel,
    status: 'GRANTED' | 'REVOKED',
    source: string,
    evidence: string | null,
    basis: {
      legalBasis?: ConsentLegalBasis;
      formVersion?: string | null;
      confirmationRequestedAt?: Date | null;
      confirmedAt?: Date | null;
    },
    registryHandled = false,
  ): Promise<ContactConsent> {
    const now = new Date();
    const legal = {
      ...(basis.legalBasis !== undefined ? { legalBasis: basis.legalBasis } : {}),
      ...(basis.formVersion !== undefined ? { formVersion: basis.formVersion } : {}),
      ...(basis.confirmationRequestedAt !== undefined ? { confirmationRequestedAt: basis.confirmationRequestedAt } : {}),
      ...(basis.confirmedAt !== undefined ? { confirmedAt: basis.confirmedAt } : {}),
    };
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
        ...legal,
      },
      update: {
        status,
        source,
        evidence,
        grantedAt: status === 'GRANTED' ? now : undefined,
        revokedAt: status === 'REVOKED' ? now : null,
        iysSyncedAt: registryHandled ? now : null,
        ...legal,
      },
    });
    await this.prisma.contactActivity.create({
      data: {
        studioId,
        contactId,
        type: 'CONSENT',
        body: `${channel} ${status} ${row.legalBasis ?? 'CONSENT'}`,
        metadata: {
          event: status === 'GRANTED' ? (isConfirmationPending(row) ? 'granted_pending_confirmation' : 'granted') : 'revoked',
          channel,
          status,
          source,
          legalBasis: row.legalBasis ?? 'CONSENT',
          formVersion: row.formVersion,
        },
      },
    });
    if (!registryHandled) {
      // Best effort now; syncPending() retries on the heartbeat.
      await this.syncOne(row.id).catch((err: Error) => this.logger.warn(`Contact consent registry sync failed: ${err.message}`));
    }
    return row;
  }

  private async syncOne(id: string): Promise<boolean> {
    const row = await this.prisma.contactConsent.findUnique({
      where: { id },
      include: { contact: { select: { phone: true, email: true, countryCode: true } }, studio: { select: { countryCode: true } } },
    });
    if (!row || row.iysSyncedAt) return true;
    // A consent waiting for its double opt-in is not a consent yet: pushed once confirmed.
    if (isConfirmationPending(row)) return true;
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
      recipientType: row.legalBasis === 'TR_MERCHANT_EXEMPTION' ? 'MERCHANT' : 'INDIVIDUAL',
    });
    if (result.success) await this.prisma.contactConsent.update({ where: { id }, data: { iysSyncedAt: new Date() } });
    return result.success;
  }

  /** Heartbeat: pushes every contact consent change not yet reported (pending double opt-ins wait). */
  async syncPending(): Promise<{ synced: number; failed: number }> {
    const pending = await this.prisma.contactConsent.findMany({
      where: { iysSyncedAt: null, NOT: { status: 'GRANTED', confirmationRequestedAt: { not: null }, confirmedAt: null } },
      select: { id: true },
      take: 500,
    });
    let synced = 0;
    let failed = 0;
    for (const row of pending) {
      if (await this.syncOne(row.id).catch(() => false)) synced += 1;
      else failed += 1;
    }
    return { synced, failed };
  }
}
