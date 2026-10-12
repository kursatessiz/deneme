import { BadRequestException, ConflictException } from '@nestjs/common';
import { ERASED_NAME_PLACEHOLDER, ERASED_PHONE_PREFIX } from '@platform/shared';
import { ErasureAnonymizerService, erasedPhonePlaceholder, isErasable } from './erasure-anonymizer.service';

const STUDIO = 'studio-1';
const MEMBERSHIP = 'membership-1';
const PROFILE = 'profile-1';
const USER = 'user-1';
const PHONE = '+905550000001';

interface Call {
  model: string;
  method: string;
  args: Record<string, unknown>;
}

interface Scenario {
  /** Memberships of the same user that are NOT the erased one. */
  otherMemberships: number;
  /** False simulates a membership another run already erased. */
  claimed?: boolean;
}

/** A transaction client that records every call and answers the few reads the anonymizer needs. */
function build(scenario: Scenario) {
  const calls: Call[] = [];
  const contactReads: number[] = [];
  const answer = (model: string, method: string): unknown => {
    switch (`${model}.${method}`) {
      case 'user.findUniqueOrThrow':
        return { id: USER, phone: PHONE, email: 'person@example.test' };
      case 'membership.count':
        return scenario.otherMemberships;
      case 'membership.updateMany':
        return { count: scenario.claimed === false ? 0 : 1 };
      case 'user.create':
        return { id: 'anonymous-user' };
      case 'contact.findMany':
        contactReads.push(1);
        return contactReads.length === 1 ? [{ id: 'contact-1' }] : [];
      case 'lead.findMany':
        return [{ id: 'lead-1' }];
      case 'memberProfile.findUniqueOrThrow':
        return { familyGroupId: 'family-1' };
      case 'memberProfile.count':
        return 0;
      case 'notificationLog.findMany':
        return [{ id: 'log-1' }];
      case 'invoice.findMany':
        return [{ id: 'invoice-1', buyerSnapshot: { kind: 'INDIVIDUAL', fullName: 'Ada Lovelace', tckn: '12345678901' } }];
      default:
        return method === 'updateMany' || method === 'deleteMany' ? { count: 1 } : undefined;
    }
  };
  const tx = new Proxy(
    {},
    {
      get: (_target, model: string) =>
        new Proxy(
          {},
          {
            get: (_t, method: string) => async (args: Record<string, unknown> = {}) => {
              calls.push({ model, method, args });
              return answer(model, method);
            },
          },
        ),
    },
  );
  const prisma = {
    membership: {
      findFirst: jest.fn().mockResolvedValue({
        id: MEMBERSHIP,
        studioId: STUDIO,
        userId: USER,
        erasedAt: null,
        roleTemplate: { isOwner: false, permissions: [] },
        memberProfile: { id: PROFILE },
        trainerProfile: null,
        user: { isSuperAdmin: false, platformMembership: null },
      }),
    },
    booking: { findMany: jest.fn().mockResolvedValue([]) },
    contact: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (fn: (client: unknown) => Promise<void>) => fn(tx)),
  };
  const schedules = { cancelBooking: jest.fn() };
  const consent = { revokeAllForErasure: jest.fn().mockResolvedValue(0) };
  const contactConsent = { syncContact: jest.fn() };
  const service = new ErasureAnonymizerService(prisma as never, schedules as never, consent as never, contactConsent as never);
  const of = (model: string, method?: string) => calls.filter((c) => c.model === model && (!method || c.method === method));
  return { service, calls, of, prisma, schedules, consent };
}

describe('erasedPhonePlaceholder', () => {
  it('is unique, fits the phone column and can never be a routable number', () => {
    const a = erasedPhonePlaceholder();
    const b = erasedPhonePlaceholder();
    expect(a).not.toEqual(b);
    expect(a.startsWith(ERASED_PHONE_PREFIX)).toBe(true);
    expect(a.length).toBeLessThanOrEqual(20);
    expect(a.startsWith('+')).toBe(false);
  });
});

describe('isErasable', () => {
  const base = {
    roleTemplate: { isOwner: false, permissions: [] },
    trainerProfileId: null,
    memberProfileId: 'p',
    user: { isSuperAdmin: false, hasPlatformMembership: false },
  };
  it('accepts a plain member', () => expect(isErasable(base)).toBe(true));
  it('refuses owner, staff roles, trainers, platform accounts and memberships without a member profile', () => {
    expect(isErasable({ ...base, roleTemplate: { isOwner: true, permissions: [] } })).toBe(false);
    expect(isErasable({ ...base, roleTemplate: { isOwner: false, permissions: ['members.view'] } })).toBe(false);
    expect(isErasable({ ...base, trainerProfileId: 't' })).toBe(false);
    expect(isErasable({ ...base, user: { isSuperAdmin: true, hasPlatformMembership: false } })).toBe(false);
    expect(isErasable({ ...base, user: { isSuperAdmin: false, hasPlatformMembership: true } })).toBe(false);
    expect(isErasable({ ...base, memberProfileId: null })).toBe(false);
  });
});

describe('ErasureAnonymizerService', () => {
  it('wipes the personal fields of the profile, CRM rows, messaging and consents', async () => {
    const { service, of } = build({ otherMemberships: 1 });
    await service.anonymizeMembership(STUDIO, MEMBERSHIP, { requestId: 'req-1' });

    expect(of('memberProfile', 'update')[0].args.data).toEqual(
      expect.objectContaining({ birthDate: null, emergencyContactName: null, emergencyContactPhone: null, medicalConditions: null, notes: null, familyGroupId: null }),
    );
    for (const model of ['memberHealthSettings', 'healthSyncRecord', 'healthDailySummary', 'measurementEntry', 'memberGoal', 'videoView', 'storedCard', 'billingProfile', 'communityReaction']) {
      expect(of(model, 'deleteMany')).toHaveLength(1);
    }
    expect(of('contact', 'updateMany')[0].args.data).toEqual(expect.objectContaining({ firstName: ERASED_NAME_PLACEHOLDER, phone: null, email: null, notes: null, tags: [] }));
    expect(of('lead', 'updateMany')[0].args.data).toEqual(expect.objectContaining({ fullName: ERASED_NAME_PLACEHOLDER, email: null, openPhone: null }));
    expect(of('notificationLog', 'updateMany')[0].args.data).toEqual(
      expect.objectContaining({ recipientPhone: null, recipientEmail: null, userId: null, content: '' }),
    );
    expect(of('conversation', 'deleteMany')).toHaveLength(1);
    expect(of('consent', 'updateMany')[0].args.data).toEqual({ ip: null, device: null });
    expect(of('consent', 'deleteMany')[0].args.where).toEqual(expect.objectContaining({ documentVersion: { type: 'HEALTH_DATA' } }));
    expect(of('communityPost', 'updateMany')[0].args.data).toEqual({ authorMembershipId: null });
    expect(of('communityComment', 'updateMany')[0].args.data).toEqual({ authorMembershipId: null });
    expect(of('sessionRating', 'updateMany')[0].args.data).toEqual({ comment: null });
    expect(of('invoice', 'update')[0].args.data).toEqual({ buyerSnapshot: { kind: 'INDIVIDUAL' } });
    expect(of('auditLog', 'create')[0].args).toEqual(expect.objectContaining({ data: expect.objectContaining({ action: 'erasure.executed', entityId: MEMBERSHIP }) }));
  });

  it('keeps payment, invoice, booking, sale and accounting rows: they are updated in place, never deleted', async () => {
    const { service, calls, of } = build({ otherMemberships: 1 });
    await service.anonymizeMembership(STUDIO, MEMBERSHIP);

    const kept = ['payment', 'invoice', 'booking', 'sale', 'saleLine', 'expense', 'memberPackage', 'eventRegistration', 'giftCard', 'payrollLine', 'smsTransaction'];
    const destructive = calls.filter((c) => kept.includes(c.model) && ['delete', 'deleteMany', 'create', 'createMany'].includes(c.method));
    expect(destructive).toEqual([]);
    expect(of('payment', 'updateMany')[0].args.data).toEqual({ notes: null });
    expect(of('sale', 'updateMany')[0].args.data).toEqual({ customerName: null, note: null });
    expect(of('booking', 'updateMany')[0].args.data).toEqual({ cancellationReason: null });
    // The membership row itself stays: terminal PASSIVE state plus erasedAt.
    expect(of('membership', 'updateMany')[0].args.data).toEqual(expect.objectContaining({ status: 'PASSIVE', erasedAt: expect.any(Date) }));
    expect(of('membership', 'delete')).toHaveLength(0);
  });

  it('scopes every studio table to the studio and leaves the real user and other studios alone when other memberships exist', async () => {
    const { service, calls, of } = build({ otherMemberships: 2 });
    const summary = await service.anonymizeMembership(STUDIO, MEMBERSHIP);

    const writes = calls.filter((c) => ['updateMany', 'deleteMany'].includes(c.method));
    const unscoped = writes.filter((c) => {
      const where = JSON.stringify(c.args.where ?? {});
      return !where.includes(STUDIO) && !where.includes(MEMBERSHIP) && !where.includes('log-1') && !where.includes('contact-1');
    });
    // The only writes without a studio, membership or already studio-scoped id filter belong to the erased person's own rows.
    expect(unscoped.map((c) => `${c.model}.${c.method}`)).toEqual([]);

    // Split off: a new anonymous user takes the membership; the real user row is never written.
    expect(of('user', 'create')).toHaveLength(1);
    expect(of('user', 'create')[0].args.data).toEqual(expect.objectContaining({ isActive: false, firstName: ERASED_NAME_PLACEHOLDER }));
    expect(of('user', 'update')).toHaveLength(0);
    expect(of('membership', 'update')[0].args).toEqual(expect.objectContaining({ where: { id: MEMBERSHIP }, data: { userId: 'anonymous-user' } }));
    expect(of('pushDevice')).toHaveLength(0);
    expect(of('calendarFeedToken')).toHaveLength(0);
    expect(of('userMfaRecoveryCode')).toHaveLength(0);
    expect(summary.usersSplitOff).toBe(1);
    expect(summary.usersAnonymized).toBeUndefined();
  });

  it('anonymizes the global user and closes the login only when no other membership is left', async () => {
    const { service, of } = build({ otherMemberships: 0 });
    const summary = await service.anonymizeMembership(STUDIO, MEMBERSHIP);

    expect(of('user', 'create')).toHaveLength(0);
    const data = of('user', 'update')[0].args.data as Record<string, unknown>;
    expect(String(data.phone).startsWith(ERASED_PHONE_PREFIX)).toBe(true);
    expect(data).toEqual(
      expect.objectContaining({
        email: null,
        firstName: ERASED_NAME_PLACEHOLDER,
        lastName: ERASED_NAME_PLACEHOLDER,
        pinHash: null,
        passwordHash: null,
        refreshTokenHash: null,
        totpSecretEncrypted: null,
        mfaEnabledAt: null,
        isActive: false,
      }),
    );
    expect(of('userMfaRecoveryCode', 'deleteMany')).toHaveLength(1);
    expect(of('pushDevice', 'deleteMany')).toHaveLength(1);
    expect(of('calendarFeedToken', 'deleteMany')).toHaveLength(1);
    expect(of('otpChallenge', 'deleteMany')[0].args.where).toEqual({ phone: PHONE });
    expect(of('membership', 'update')).toHaveLength(0);
    expect(summary.usersAnonymized).toBe(1);
  });

  it('does nothing when another run already erased the membership (idempotent)', async () => {
    const { service, calls } = build({ otherMemberships: 0, claimed: false });
    const summary = await service.anonymizeMembership(STUDIO, MEMBERSHIP);
    expect(calls.map((c) => `${c.model}.${c.method}`)).toEqual(['membership.updateMany']);
    expect(summary.usersAnonymized).toBeUndefined();
  });

  it('refuses staff memberships and an already erased membership before touching any data', async () => {
    const staff = build({ otherMemberships: 0 });
    staff.prisma.membership.findFirst.mockResolvedValueOnce({
      id: MEMBERSHIP,
      studioId: STUDIO,
      userId: USER,
      erasedAt: null,
      roleTemplate: { isOwner: true, permissions: [] },
      memberProfile: { id: PROFILE },
      trainerProfile: null,
      user: { isSuperAdmin: false, platformMembership: null },
    });
    await expect(staff.service.anonymizeMembership(STUDIO, MEMBERSHIP)).rejects.toBeInstanceOf(BadRequestException);
    expect(staff.prisma.$transaction).not.toHaveBeenCalled();

    const erased = build({ otherMemberships: 0 });
    erased.prisma.membership.findFirst.mockResolvedValueOnce({
      id: MEMBERSHIP,
      studioId: STUDIO,
      userId: USER,
      erasedAt: new Date(),
      roleTemplate: { isOwner: false, permissions: [] },
      memberProfile: { id: PROFILE },
      trainerProfile: null,
      user: { isSuperAdmin: false, platformMembership: null },
    });
    await expect(erased.service.anonymizeMembership(STUDIO, MEMBERSHIP)).rejects.toBeInstanceOf(ConflictException);
    expect(erased.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('revokes registry consents and cancels future bookings before the transaction', async () => {
    const { service, schedules, consent, prisma } = build({ otherMemberships: 1 });
    prisma.booking.findMany.mockResolvedValueOnce([{ id: 'booking-1' }, { id: 'booking-2' }]);
    schedules.cancelBooking.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('already cancelled'));
    const summary = await service.anonymizeMembership(STUDIO, MEMBERSHIP);

    expect(consent.revokeAllForErasure).toHaveBeenCalledWith(STUDIO, USER);
    expect(schedules.cancelBooking).toHaveBeenCalledTimes(2);
    expect(schedules.cancelBooking.mock.calls[0][1]).toEqual({ bookingId: 'booking-1', cancelledBy: 'STUDIO', waivePenalty: true });
    expect(summary.futureBookingsCancelled).toBe(1);
  });
});
