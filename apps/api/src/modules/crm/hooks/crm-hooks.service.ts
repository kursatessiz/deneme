import { Injectable, Logger } from '@nestjs/common';
import type { Contact } from '@platform/database';
import { PrismaService } from '../../prisma/prisma.service';
import { ContactsService } from '../contacts/contacts.service';
import { AttributionService } from '../attribution/attribution.service';
import { ConversionService } from '../conversions/conversion.service';
import { PipelineService } from '../pipeline/pipeline.service';

/**
 * Small, explicit hooks the existing business services call after their
 * own work is committed (no event bus). Every method logs and swallows its
 * errors: CRM bookkeeping must never block or fail a membership, booking,
 * check-in or payment.
 */
@Injectable()
export class CrmHooksService {
  private readonly logger = new Logger(CrmHooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
    private readonly attribution: AttributionService,
    private readonly conversions: ConversionService,
    private readonly pipeline: PipelineService,
  ) {}

  /**
   * A membership with a member profile was created or activated (invite
   * accepted, staff created the member, lead converted). Upserts the
   * contact by membership, phone or email, links it and marks it MEMBER.
   */
  async onMemberJoined(studioId: string, membershipId: string, opts: { visitorId?: string | null } = {}): Promise<Contact | null> {
    return this.safely(`member joined ${membershipId}`, async () => {
      const contact = await this.contactForMembership(studioId, membershipId);
      if (!contact) return null;
      await this.contacts.applyLifecycle(contact, 'member');
      if (opts.visitorId) await this.attribution.identify(studioId, opts.visitorId, contact.id);
      return this.prisma.contact.findUnique({ where: { id: contact.id } });
    });
  }

  /** A trial session was booked for this contact. */
  async onTrialBooked(studioId: string, contactId: string, bookingId: string): Promise<void> {
    await this.safely(`trial booked ${bookingId}`, async () => {
      const contact = await this.prisma.contact.findFirst({ where: { id: contactId, studioId } });
      if (!contact) return;
      await this.contacts.applyLifecycle(contact, 'trial', { force: contact.lifecycleStage === 'MEMBER' ? 'TRIAL' : undefined });
      await this.conversions.recordSafely({
        studioId,
        type: 'trial_booked',
        contactId,
        source: { kind: 'trial_booking', id: bookingId },
      });
    });
  }

  /**
   * A booking was checked in. For a contact still in TRIAL this is the
   * attended trial: records trial_attended and moves a TRIAL_BOOKED
   * pipeline card to TRIAL_DONE.
   */
  async onBookingAttended(studioId: string, bookingId: string): Promise<void> {
    await this.safely(`booking attended ${bookingId}`, async () => {
      const booking = await this.prisma.booking.findFirst({
        where: { id: bookingId, studioId },
        select: { member: { select: { membershipId: true } } },
      });
      if (!booking) return;
      const contact = await this.prisma.contact.findFirst({
        where: { studioId, membershipId: booking.member.membershipId, mergedIntoId: null },
        include: { pipelineStage: true },
      });
      if (!contact || contact.lifecycleStage !== 'TRIAL') return;
      await this.conversions.recordSafely({
        studioId,
        type: 'trial_attended',
        contactId: contact.id,
        source: { kind: 'trial_attendance', id: bookingId },
      });
      if (contact.pipelineStage?.key === 'TRIAL_BOOKED') {
        await this.contacts.moveToStage(contact, 'TRIAL_DONE');
      }
    });
  }

  /**
   * A payment reached COMPLETED. Subscription charges record
   * subscription_started (first charge) or subscription_renewed; any other
   * payment records purchase. A trial-offer package keeps the contact in
   * TRIAL, anything else makes it MEMBER.
   */
  async onPaymentCompleted(studioId: string, paymentId: string): Promise<void> {
    await this.safely(`payment ${paymentId}`, async () => {
      const payment = await this.prisma.payment.findFirst({
        where: { id: paymentId, studioId, paymentStatus: 'COMPLETED' },
        include: {
          member: { select: { membershipId: true } },
          memberPackage: { select: { packageDefinition: { select: { isTrial: true } } } },
        },
      });
      if (!payment) return;
      const contact = await this.contactForMembership(studioId, payment.member.membershipId);
      if (!contact) return;

      const value = { amount: payment.amount.toFixed(2), currency: payment.currency };
      if (payment.memberSubscriptionId) {
        const earlier = await this.prisma.payment.count({
          where: {
            studioId,
            memberSubscriptionId: payment.memberSubscriptionId,
            paymentStatus: { in: ['COMPLETED', 'REFUNDED'] },
            id: { not: payment.id },
            paidAt: { lte: payment.paidAt },
          },
        });
        await this.conversions.recordSafely({
          studioId,
          type: earlier === 0 ? 'subscription_started' : 'subscription_renewed',
          contactId: contact.id,
          occurredAt: payment.paidAt,
          value,
          source: { kind: 'subscription_payment', id: payment.id },
        });
      } else {
        await this.conversions.recordSafely({
          studioId,
          type: 'purchase',
          contactId: contact.id,
          occurredAt: payment.paidAt,
          value,
          source: { kind: 'payment', id: payment.id },
        });
      }
      const isTrial = payment.memberPackage?.packageDefinition.isTrial ?? false;
      await this.contacts.applyLifecycle(contact, isTrial ? 'trial' : 'member');
    });
  }

  /**
   * Marks MEMBER contacts LAPSED once none of their packages is usable any
   * more (no ACTIVE or FROZEN package that ends in the future) and no
   * subscription is running. Contacts that never had a package stay MEMBER.
   * Called from the scheduler heartbeat.
   */
  async sweepLapsed(now = new Date()): Promise<{ lapsed: number }> {
    const result = await this.safely('lapsed sweep', async () => {
      const lapsed = await this.prisma.$executeRaw`
        UPDATE "contacts" c
        SET "lifecycle_stage" = 'LAPSED', "updated_at" = ${now}
        FROM "member_profiles" mp
        WHERE c."membership_id" = mp."membership_id"
          AND c."lifecycle_stage" = 'MEMBER'
          AND c."merged_into_id" IS NULL
          AND EXISTS (SELECT 1 FROM "member_packages" p WHERE p."member_id" = mp."id")
          AND NOT EXISTS (
            SELECT 1 FROM "member_packages" p
            WHERE p."member_id" = mp."id" AND p."status" IN ('ACTIVE', 'FROZEN') AND p."end_date" > ${now}
          )
          AND NOT EXISTS (
            SELECT 1 FROM "member_subscriptions" s
            WHERE s."member_id" = mp."id" AND s."status" IN ('ACTIVE', 'PAST_DUE')
          )`;
      return { lapsed };
    });
    return result ?? { lapsed: 0 };
  }

  /** Super admin created a tenant: default pipeline stages, and studio_signup on the platform tenant. */
  async onStudioCreated(newStudioId: string, ownerPhone: string): Promise<void> {
    await this.safely(`studio created ${newStudioId}`, async () => {
      await this.pipeline.ensureDefaults(newStudioId);
      await this.conversions.recordStudioSignup(newStudioId, ownerPhone);
    });
  }

  /** The contact linked to a member membership, created (and linked) when missing. */
  private async contactForMembership(studioId: string, membershipId: string): Promise<Contact | null> {
    const linked = await this.prisma.contact.findFirst({ where: { studioId, membershipId, mergedIntoId: null } });
    if (linked) return linked;

    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, studioId },
      include: { user: true, memberProfile: { select: { id: true } } },
    });
    if (!membership || !membership.memberProfile || membership.isPartnerGuest) return null;

    const { contact } = await this.contacts.resolveOrCreate(studioId, {
      firstName: membership.user.firstName,
      lastName: membership.user.lastName,
      phone: membership.user.phone,
      email: membership.user.email,
      locale: membership.user.locale,
      lifecycleStage: 'MEMBER',
    });
    if (contact.membershipId === membershipId) return contact;
    if (contact.membershipId) {
      this.logger.warn(`Contact ${contact.id} already linked to another membership; ${membershipId} left unlinked`);
      return contact;
    }
    return this.prisma.contact.update({ where: { id: contact.id }, data: { membershipId } });
  }

  private async safely<T>(what: string, fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (err) {
      this.logger.warn(`CRM hook failed (${what}): ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}
