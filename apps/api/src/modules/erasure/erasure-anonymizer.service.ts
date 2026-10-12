import { randomBytes } from 'crypto';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DocumentType, Prisma } from '@prisma/client';
import { ERASED_NAME_PLACEHOLDER, ERASED_PHONE_PREFIX, ERASURE_AUDIT_ACTIONS, type CancelBookingInput, type ErasureSummary } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SchedulesService } from '../schedules/schedules.service';
import { ConsentService } from '../notifications/consent/consent.service';
import { ContactConsentService } from '../notifications/consent/contact-consent.service';
import type { TenantContext } from '../auth/tenant-context';
import { apiError } from '../../common/api-error';

/** Unique, non-routable phone value: never valid E.164, so no login, OTP or message can reach it. */
export function erasedPhonePlaceholder(): string {
  return `${ERASED_PHONE_PREFIX}${randomBytes(6).toString('hex')}`;
}

/** What the eligibility check needs to know about a membership. */
export interface ErasureEligibilityInput {
  roleTemplate: { isOwner: boolean; permissions: readonly unknown[] };
  trainerProfileId: string | null;
  memberProfileId: string | null;
  user: { isSuperAdmin: boolean; hasPlatformMembership: boolean };
}

/**
 * Only plain members can be erased with this flow. The owner, staff roles,
 * trainers (payroll and commission rows point at them) and platform accounts
 * are refused, and so is a membership that has no member profile.
 */
export function isErasable(input: ErasureEligibilityInput): boolean {
  if (!input.memberProfileId) return false;
  if (input.roleTemplate.isOwner || input.roleTemplate.permissions.length > 0) return false;
  if (input.trainerProfileId) return false;
  if (input.user.isSuperAdmin || input.user.hasPlatformMembership) return false;
  return true;
}

export interface ErasureMembershipFacts {
  id: string;
  studioId: string;
  userId: string;
  erasedAt: Date | null;
  memberProfileId: string | null;
}

/**
 * Anonymizes the personal data of one studio membership (KVKK/GDPR erasure,
 * docs/KVKK_SILME.md). Payment, invoice, booking, sale, event and accounting
 * rows are kept (legal retention) but stop identifying the person.
 *
 * Users are global: when the person still belongs to other studios the
 * erased membership is moved onto a fresh anonymous User row, so the real
 * account and every other membership stay untouched and every join in this
 * studio shows the anonymous identity. When no other membership is left the
 * global User itself is anonymized in place and its login is closed.
 */
@Injectable()
export class ErasureAnonymizerService {
  private readonly logger = new Logger(ErasureAnonymizerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly schedules: SchedulesService,
    private readonly consent: ConsentService,
    private readonly contactConsent: ContactConsentService,
  ) {}

  /** Loads the facts the request flow needs and refuses ineligible memberships. */
  async loadEligibleMembership(studioId: string, membershipId: string): Promise<ErasureMembershipFacts> {
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, studioId },
      include: {
        roleTemplate: { select: { isOwner: true, permissions: { select: { permissionKey: true } } } },
        memberProfile: { select: { id: true } },
        trainerProfile: { select: { id: true } },
        user: { select: { isSuperAdmin: true, platformMembership: { select: { id: true } } } },
      },
    });
    if (!membership) throw new NotFoundException(apiError('apiErrors.common.memberNotFound'));
    if (membership.erasedAt) throw new ConflictException(apiError('apiErrors.erasure.alreadyErased'));
    const eligible = isErasable({
      roleTemplate: membership.roleTemplate,
      trainerProfileId: membership.trainerProfile?.id ?? null,
      memberProfileId: membership.memberProfile?.id ?? null,
      user: { isSuperAdmin: membership.user.isSuperAdmin, hasPlatformMembership: Boolean(membership.user.platformMembership) },
    });
    if (!eligible) throw new BadRequestException(apiError('apiErrors.erasure.staffNotErasable'));
    return {
      id: membership.id,
      studioId: membership.studioId,
      userId: membership.userId,
      erasedAt: membership.erasedAt,
      memberProfileId: membership.memberProfile?.id ?? null,
    };
  }

  /**
   * Runs the erasure. Idempotent: a membership already erased yields an
   * empty summary. Future bookings are cancelled first (through the normal
   * cancellation path, so capacity and the waitlist stay correct); the rest
   * is one transaction, so a failure leaves the data untouched and the
   * request is retried by the heartbeat.
   */
  async anonymizeMembership(studioId: string, membershipId: string, options: { requestId?: string; now?: Date } = {}): Promise<ErasureSummary> {
    const now = options.now ?? new Date();
    const facts = await this.loadEligibleMembership(studioId, membershipId);
    const summary: ErasureSummary = {};
    const memberProfileId = facts.memberProfileId as string;

    summary.futureBookingsCancelled = await this.cancelFutureBookings(studioId, memberProfileId, now);
    await this.revokeRegistryConsents(studioId, facts.userId, now);

    await this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.membership.updateMany({
          where: { id: membershipId, studioId, erasedAt: null },
          data: { erasedAt: now, status: 'PASSIVE' },
        });
        if (claimed.count === 0) return;
        await this.anonymizeInTransaction(tx, { ...facts, memberProfileId }, now, summary, options.requestId ?? null);
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
    return summary;
  }

  /** Cancels the member's confirmed future bookings and removes waitlist entries. */
  private async cancelFutureBookings(studioId: string, memberProfileId: string, now: Date): Promise<number> {
    const upcoming = await this.prisma.booking.findMany({
      where: { studioId, memberId: memberProfileId, status: 'CONFIRMED', schedule: { startTime: { gt: now } } },
      select: { id: true },
    });
    // A system context: erasure is authorised by the request flow, not by a branch scope.
    const system: TenantContext = {
      studioId,
      membershipId: null,
      isOwner: true,
      isSuperAdmin: true,
      permissions: new Set(),
      memberProfileId: null,
      trainerProfileId: null,
      branchIds: null,
    };
    let cancelled = 0;
    for (const booking of upcoming) {
      const dto: CancelBookingInput = { bookingId: booking.id, cancelledBy: 'STUDIO', waivePenalty: true };
      try {
        await this.schedules.cancelBooking(system, dto);
        cancelled += 1;
      } catch (err) {
        // The booking changed state in the meantime; the rest of the erasure does not depend on it.
        this.logger.warn(`Erasure could not cancel booking ${booking.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return cancelled;
  }

  /** Pushes the revocation of every granted communication consent to the registries while the real phone number is still there. */
  private async revokeRegistryConsents(studioId: string, userId: string, now: Date): Promise<void> {
    await this.consent.revokeAllForErasure(studioId, userId);
    const contacts = await this.prisma.contact.findMany({ where: { studioId, membership: { userId } }, select: { id: true } });
    for (const contact of contacts) {
      await this.prisma.contactConsent.updateMany({
        where: { studioId, contactId: contact.id, status: 'GRANTED' },
        data: { status: 'REVOKED', revokedAt: now, iysSyncedAt: null },
      });
      await this.contactConsent
        .syncContact(studioId, contact.id)
        .catch((err: Error) => this.logger.warn(`Contact consent revocation sync failed during erasure: ${err.message}`));
    }
  }

  private async anonymizeInTransaction(
    tx: Prisma.TransactionClient,
    facts: Omit<ErasureMembershipFacts, 'memberProfileId'> & { memberProfileId: string },
    now: Date,
    summary: ErasureSummary,
    requestId: string | null,
  ): Promise<void> {
    const { studioId, id: membershipId, userId, memberProfileId } = facts;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, phone: true, email: true } });
    const otherMemberships = await tx.membership.count({ where: { userId, id: { not: membershipId } } });
    const anonymizeUserInPlace = otherMemberships === 0;
    const mark = (label: string, count: number) => {
      if (count > 0) summary[label] = (summary[label] ?? 0) + count;
    };

    // The identity every studio-scoped row of this person points at afterwards.
    let holderUserId = userId;
    if (!anonymizeUserInPlace) {
      const placeholder = await tx.user.create({
        data: {
          phone: erasedPhonePlaceholder(),
          firstName: ERASED_NAME_PLACEHOLDER,
          lastName: ERASED_NAME_PLACEHOLDER,
          isActive: false,
        },
        select: { id: true },
      });
      holderUserId = placeholder.id;
      mark('usersSplitOff', 1);
    }

    // --- CRM rows of this person in this studio -------------------------------------------
    const contactIds = await this.findContactIds(tx, studioId, membershipId, user);
    const leadIds = (
      await tx.lead.findMany({
        where: { studioId, OR: [{ convertedMembershipId: membershipId }, { phone: user.phone }] },
        select: { id: true },
      })
    ).map((l) => l.id);
    const identifierPhones = [user.phone];
    const identifierEmails = user.email ? [user.email, user.email.toLowerCase()] : [];

    // --- Member profile, health and measurements -------------------------------------------
    const profile = await tx.memberProfile.findUniqueOrThrow({ where: { id: memberProfileId }, select: { familyGroupId: true } });
    await tx.memberProfile.update({
      where: { id: memberProfileId },
      data: {
        birthDate: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        medicalConditions: null,
        notes: null,
        familyGroupId: null,
        homeBranchId: null,
        leaderboardOptIn: false,
      },
    });
    mark('memberProfiles', 1);
    if (profile.familyGroupId) {
      const left = await tx.memberProfile.count({ where: { familyGroupId: profile.familyGroupId } });
      if (left === 0) mark('familyGroups', (await tx.familyGroup.deleteMany({ where: { id: profile.familyGroupId, studioId } })).count);
    }
    mark('memberHealthSettings', (await tx.memberHealthSettings.deleteMany({ where: { memberId: memberProfileId, studioId } })).count);
    mark('healthSyncRecords', (await tx.healthSyncRecord.deleteMany({ where: { memberId: memberProfileId, studioId } })).count);
    mark('healthDailySummaries', (await tx.healthDailySummary.deleteMany({ where: { memberId: memberProfileId, studioId } })).count);
    mark('measurementEntries', (await tx.measurementEntry.deleteMany({ where: { memberId: memberProfileId, studioId } })).count);

    // --- Derived member data ------------------------------------------------------------------
    mark('memberRiskSnapshots', (await tx.memberRiskSnapshot.deleteMany({ where: { memberId: memberProfileId, studioId } })).count);
    mark('memberRiskHistory', (await tx.memberRiskHistory.deleteMany({ where: { memberId: memberProfileId, studioId } })).count);
    mark('memberBadges', (await tx.memberBadge.deleteMany({ where: { memberId: memberProfileId, studioId } })).count);
    mark('memberGoals', (await tx.memberGoal.deleteMany({ where: { memberId: memberProfileId, studioId } })).count);
    mark('videoViews', (await tx.videoView.deleteMany({ where: { memberId: memberProfileId, studioId } })).count);
    mark('referralCodes', (await tx.referralCode.deleteMany({ where: { memberId: memberProfileId, studioId } })).count);
    mark('loyaltyLedgerNotes', (await tx.loyaltyLedger.updateMany({ where: { membershipId, studioId, note: { not: null } }, data: { note: null } })).count);
    mark('waitlistEntries', (await tx.waitlist.deleteMany({ where: { memberId: memberProfileId, studioId } })).count);
    mark('dashboardLayouts', (await tx.dashboardLayout.deleteMany({ where: { membershipId, studioId } })).count);
    mark('membershipBranches', (await tx.membershipBranch.deleteMany({ where: { membershipId } })).count);

    // --- Cards and subscriptions: stop charging, drop the provider card token -------------------
    mark(
      'memberSubscriptionsCancelled',
      (await tx.memberSubscription.updateMany({ where: { memberId: memberProfileId, studioId, status: { not: 'CANCELLED' } }, data: { status: 'CANCELLED', cancelAtPeriodEnd: true } })).count,
    );
    mark('storedCards', (await tx.storedCard.deleteMany({ where: { memberId: memberProfileId, studioId } })).count);

    // --- Financial rows: kept, but no longer identifying ----------------------------------------
    mark('billingProfiles', (await tx.billingProfile.deleteMany({ where: { memberId: memberProfileId, studioId } })).count);
    const payerFilter: Prisma.PaymentWhereInput = {
      studioId,
      OR: [{ memberId: memberProfileId }, ...(contactIds.length ? [{ contactId: { in: contactIds } }] : [])],
    };
    mark('paymentNotes', (await tx.payment.updateMany({ where: { ...payerFilter, notes: { not: null } }, data: { notes: null } })).count);
    const invoices = await tx.invoice.findMany({ where: { studioId, payment: payerFilter }, select: { id: true, buyerSnapshot: true } });
    for (const invoice of invoices) {
      const snapshot = invoice.buyerSnapshot as { kind?: string } | null;
      await tx.invoice.update({ where: { id: invoice.id }, data: { buyerSnapshot: { kind: snapshot?.kind === 'COMPANY' ? 'COMPANY' : 'INDIVIDUAL' } } });
    }
    mark('invoiceBuyerSnapshots', invoices.length);
    const saleFilter: Prisma.SaleWhereInput = {
      studioId,
      OR: [{ memberId: memberProfileId }, ...(contactIds.length ? [{ contactId: { in: contactIds } }] : [])],
    };
    mark('saleCustomers', (await tx.sale.updateMany({ where: saleFilter, data: { customerName: null, note: null } })).count);
    const eventFilter: Prisma.EventRegistrationWhereInput = {
      studioId,
      OR: [{ memberId: memberProfileId }, ...(contactIds.length ? [{ contactId: { in: contactIds } }] : [])],
    };
    mark('eventRegistrationTexts', (await tx.eventRegistration.updateMany({ where: eventFilter, data: { notes: null, cancellationReason: null } })).count);
    mark(
      'giftCardPersonalFields',
      (
        await tx.giftCard.updateMany({
          where: { studioId, OR: [{ purchaserUserId: userId }, { recipientPhone: user.phone }] },
          data: { recipientName: null, recipientPhone: null, message: null, purchaserUserId: null },
        })
      ).count,
    );
    mark('bookingCancellationReasons', (await tx.booking.updateMany({ where: { memberId: memberProfileId, studioId, cancellationReason: { not: null } }, data: { cancellationReason: null } })).count);
    mark('ratingComments', (await tx.sessionRating.updateMany({ where: { memberId: memberProfileId, studioId, comment: { not: null } }, data: { comment: null } })).count);
    mark(
      'partnerGuests',
      (await tx.partnerGuest.updateMany({ where: { studioId, userId }, data: { phone: null, fullName: ERASED_NAME_PLACEHOLDER, externalGuestId: null } })).count,
    );

    // --- Consents: proof rows stay without identifiers --------------------------------------------
    mark(
      'healthDataConsentsDeleted',
      (await tx.consent.deleteMany({ where: { membershipId, documentVersion: { type: DocumentType.HEALTH_DATA } } })).count,
    );
    mark('consentIdentifiersStripped', (await tx.consent.updateMany({ where: { membershipId }, data: { ip: null, device: null } })).count);
    mark(
      'communicationConsents',
      (await tx.communicationConsent.updateMany({ where: { studioId, userId }, data: { status: 'REVOKED', revokedAt: now, iysSyncedAt: now } })).count,
    );
    const consentContactFilter: Prisma.ContactConsentWhereInput = { studioId, contactId: { in: contactIds } };
    if (contactIds.length) {
      mark(
        'contactConsents',
        (await tx.contactConsent.updateMany({ where: consentContactFilter, data: { status: 'REVOKED', revokedAt: now, evidence: null, iysSyncedAt: now } })).count,
      );
      mark('contactConsentConfirmations', (await tx.contactConsentConfirmation.deleteMany({ where: { studioId, contactConsent: { contactId: { in: contactIds } } } })).count);
    }

    // --- Messaging: logs lose recipients and content, conversations are deleted ---------------------
    const logFilter: Prisma.NotificationLogWhereInput = {
      studioId,
      OR: [
        { userId },
        { recipientPhone: { in: identifierPhones } },
        ...(identifierEmails.length ? [{ recipientEmail: { in: identifierEmails } }] : []),
        ...(contactIds.length ? [{ contactId: { in: contactIds } }] : []),
      ],
    };
    const logIds = (await tx.notificationLog.findMany({ where: logFilter, select: { id: true } })).map((l) => l.id);
    if (logIds.length) {
      mark('messageLinks', (await tx.messageLink.deleteMany({ where: { notificationLogId: { in: logIds } } })).count);
      mark(
        'notificationLogs',
        (
          await tx.notificationLog.updateMany({
            where: { id: { in: logIds } },
            data: { recipientPhone: null, recipientEmail: null, userId: null, contactId: null, subject: null, content: '', errorMessage: null },
          })
        ).count,
      );
    }
    if (contactIds.length) {
      mark('conversations', (await tx.conversation.deleteMany({ where: { studioId, contactId: { in: contactIds } } })).count);
      mark('contactActivities', (await tx.contactActivity.deleteMany({ where: { studioId, contactId: { in: contactIds } } })).count);
      mark('contactTasks', (await tx.contactTask.deleteMany({ where: { studioId, contactId: { in: contactIds } } })).count);
      mark('segmentMembers', (await tx.segmentMember.deleteMany({ where: { studioId, contactId: { in: contactIds } } })).count);
      mark(
        'campaignRecipientsCancelled',
        (await tx.campaignRecipient.updateMany({ where: { studioId, contactId: { in: contactIds }, status: 'PENDING' }, data: { status: 'CANCELLED', reasonCode: 'ERASED', nextAttemptAt: null } })).count,
      );
      mark(
        'journeyEnrollments',
        (
          await tx.journeyEnrollment.updateMany({
            where: { studioId, contactId: { in: contactIds } },
            data: { context: {}, nextRunAt: null, lockedUntil: null },
          })
        ).count,
      );
      await tx.journeyEnrollment.updateMany({
        where: { studioId, contactId: { in: contactIds }, status: 'ACTIVE' },
        data: { status: 'EXITED', exitReason: 'ERASED', completedAt: now },
      });
      // Unlink the anonymous browsing history and drop the browser and click identifiers.
      mark('visitorsUnlinked', (await tx.visitor.updateMany({ where: { studioId, contactId: { in: contactIds } }, data: { contactId: null } })).count);
      mark(
        'touchpointsScrubbed',
        (
          await tx.touchpoint.updateMany({
            where: { studioId, contactId: { in: contactIds } },
            data: { contactId: null, fbclid: null, gclid: null, gbraid: null, wbraid: null, ttclid: null, liFatId: null, msclkid: null, fbp: null, fbc: null },
          })
        ).count,
      );
      mark(
        'contacts',
        (
          await tx.contact.updateMany({
            where: { studioId, id: { in: contactIds } },
            data: {
              firstName: ERASED_NAME_PLACEHOLDER,
              lastName: '',
              phone: null,
              email: null,
              notes: null,
              customFields: {},
              tags: [],
              lostReason: null,
              referralCode: null,
              sourceDetail: null,
              nextFollowUpAt: null,
            },
          })
        ).count,
      );
    }
    if (leadIds.length) {
      mark('leadActivities', (await tx.leadActivity.deleteMany({ where: { studioId, leadId: { in: leadIds } } })).count);
      mark(
        'leads',
        (
          await tx.lead.updateMany({
            where: { studioId, id: { in: leadIds } },
            data: {
              fullName: ERASED_NAME_PLACEHOLDER,
              phone: erasedPhonePlaceholder(),
              openPhone: null,
              email: null,
              notes: null,
              lostReason: null,
              sourceDetail: null,
              referralCode: null,
              nextFollowUpAt: null,
            },
          })
        ).count,
      );
    }
    mark(
      'inviteTokens',
      (await tx.inviteToken.updateMany({ where: { studioId, phone: user.phone }, data: { phone: erasedPhonePlaceholder(), fullName: ERASED_NAME_PLACEHOLDER } })).count,
    );
    mark(
      'referralsAsReferred',
      (await tx.referral.updateMany({ where: { studioId, referredUserId: userId }, data: { referredPhone: erasedPhonePlaceholder() } })).count,
    );

    // --- Community: authorship is anonymized, reactions are removed ---------------------------------
    mark('communityPostsAnonymized', (await tx.communityPost.updateMany({ where: { studioId, authorMembershipId: membershipId }, data: { authorMembershipId: null } })).count);
    mark('communityCommentsAnonymized', (await tx.communityComment.updateMany({ where: { studioId, authorMembershipId: membershipId }, data: { authorMembershipId: null } })).count);
    mark('communityReactions', (await tx.communityReaction.deleteMany({ where: { studioId, membershipId } })).count);

    // --- Audit trail: entries stay, free metadata about this person goes ---------------------------
    mark(
      'auditMetadataCleared',
      (
        await tx.auditLog.updateMany({
          where: { studioId, entityId: { in: [membershipId, memberProfileId] }, NOT: { action: { startsWith: 'erasure.' } }, metadata: { not: Prisma.DbNull } },
          data: { metadata: Prisma.DbNull },
        })
      ).count,
    );

    // --- Identity: split off or anonymize in place ----------------------------------------------------
    if (!anonymizeUserInPlace) {
      // Rows keyed by (studio, user) follow the membership onto the anonymous identity.
      await tx.trialRedemption.updateMany({ where: { studioId, userId }, data: { userId: holderUserId } });
      await tx.promoRedemption.updateMany({ where: { studioId, userId }, data: { userId: holderUserId } });
      await tx.redemptionCounter.updateMany({ where: { studioId, userId }, data: { userId: holderUserId } });
      await tx.automationRun.deleteMany({ where: { studioId, userId } });
      await tx.communicationConsent.updateMany({ where: { studioId, userId }, data: { userId: holderUserId } });
      await tx.referral.updateMany({ where: { studioId, referredUserId: userId }, data: { referredUserId: holderUserId } });
      await tx.partnerGuest.updateMany({ where: { studioId, userId }, data: { userId: holderUserId } });
      await tx.auditLog.updateMany({ where: { studioId, userId }, data: { userId: holderUserId } });
      await tx.membership.update({ where: { id: membershipId }, data: { userId: holderUserId } });
    } else {
      await tx.automationRun.deleteMany({ where: { studioId, userId } });
      mark('pushDevices', (await tx.pushDevice.deleteMany({ where: { userId } })).count);
      await tx.notificationPreference.deleteMany({ where: { userId } });
      await tx.calendarFeedToken.deleteMany({ where: { userId } });
      await tx.userMfaRecoveryCode.deleteMany({ where: { userId } });
      await tx.otpChallenge.deleteMany({ where: { phone: user.phone } });
      // Platform messages without a studio (login codes) that still carry the old number.
      await tx.notificationLog.updateMany({
        where: { studioId: null, OR: [{ recipientPhone: user.phone }, { userId }] },
        data: { recipientPhone: null, recipientEmail: null, userId: null, content: '', subject: null },
      });
      await tx.user.update({
        where: { id: userId },
        data: {
          phone: erasedPhonePlaceholder(),
          email: null,
          firstName: ERASED_NAME_PLACEHOLDER,
          lastName: ERASED_NAME_PLACEHOLDER,
          pinHash: null,
          passwordHash: null,
          phoneVerifiedAt: null,
          avatarUrl: null,
          refreshTokenHash: null,
          failedPinAttempts: 0,
          pinLockedUntil: null,
          totpSecretEncrypted: null,
          mfaEnabledAt: null,
          totpLastUsedStep: null,
          locale: null,
          isActive: false,
        },
      });
      mark('usersAnonymized', 1);
    }

    await tx.auditLog.create({
      data: {
        studioId,
        userId: null,
        action: ERASURE_AUDIT_ACTIONS.executed,
        entityType: 'Membership',
        entityId: membershipId,
        metadata: { requestId, userAnonymized: anonymizeUserInPlace, tables: Object.keys(summary).length } as Prisma.InputJsonValue,
      },
    });
  }

  /** Contacts of this studio that are this person: linked to the membership, or sharing the phone or email (and their merged children). */
  private async findContactIds(tx: Prisma.TransactionClient, studioId: string, membershipId: string, user: { phone: string; email: string | null }): Promise<string[]> {
    const seeds = await tx.contact.findMany({
      where: {
        studioId,
        OR: [{ membershipId }, { phone: user.phone }, ...(user.email ? [{ email: { equals: user.email, mode: 'insensitive' as const } }] : [])],
      },
      select: { id: true },
    });
    const ids = new Set(seeds.map((c) => c.id));
    if (ids.size === 0) return [];
    const merged = await tx.contact.findMany({ where: { studioId, mergedIntoId: { in: [...ids] } }, select: { id: true } });
    for (const row of merged) ids.add(row.id);
    return [...ids];
  }
}
