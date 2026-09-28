import { ConflictException } from '@nestjs/common';
import { ContactsService, dedupeTags, searchFilter } from './contacts.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { PipelineService } from '../pipeline/pipeline.service';
import type { AttributionService } from '../attribution/attribution.service';
import type { TenantContext } from '../../auth/tenant-context';

const STUDIO = 'studio-1';
const tenant: TenantContext = {
  studioId: STUDIO,
  membershipId: 'staff-1',
  isOwner: false,
  isSuperAdmin: false,
  permissions: new Set(['crm.view', 'crm.manage']),
  memberProfileId: null,
  trainerProfileId: null,
  branchIds: null,
};

function contact(id: string, fields: Record<string, unknown> = {}) {
  return {
    id,
    studioId: STUDIO,
    firstName: 'Ada',
    lastName: 'Kaya',
    phone: null,
    email: null,
    locale: null,
    countryCode: null,
    timezone: null,
    lifecycleStage: 'LEAD',
    pipelineStageId: null,
    ownerMembershipId: null,
    branchId: null,
    tags: [],
    customFields: {},
    membershipId: null,
    firstTouchpointId: null,
    lastTouchpointId: null,
    firstSource: null,
    firstMedium: null,
    firstCampaignName: null,
    firstCampaignId: null,
    firstAdsetId: null,
    firstAdId: null,
    lastSource: null,
    lastMedium: null,
    lastCampaignName: null,
    lastCampaignId: null,
    lastAdsetId: null,
    lastAdId: null,
    sourceChannel: null,
    sourceDetail: null,
    interestServiceTypeId: null,
    lostReason: null,
    nextFollowUpAt: null,
    referralCode: null,
    notes: null,
    isTest: false,
    mergedIntoId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...fields,
  };
}

function makePrisma() {
  const tx = {
    contact: { update: jest.fn(), updateMany: jest.fn() },
    contactActivity: { updateMany: jest.fn(), create: jest.fn() },
    contactTask: { updateMany: jest.fn() },
    visitor: { updateMany: jest.fn() },
    touchpoint: { updateMany: jest.fn() },
    conversionEvent: { updateMany: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma = {
    ...tx,
    contact: {
      ...tx.contact,
      findFirst: jest.fn(),
      findFirstOrThrow: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { prisma, tx };
}

describe('ContactsService', () => {
  const pipeline = { getByKey: jest.fn() };
  const attribution = { refreshContactTouches: jest.fn() };

  describe('merge', () => {
    it('keeps survivor values, fills its blanks, unions tags and hides the loser first', async () => {
      const { prisma, tx } = makePrisma();
      const survivor = contact('s', {
        email: 'ada@example.com',
        tags: ['vip'],
        customFields: { goal: 'strength' },
        lifecycleStage: 'LEAD',
      });
      const loser = contact('m', {
        phone: '+905320000001',
        email: 'other@example.com',
        tags: ['vip', 'referral'],
        customFields: { goal: 'mobility', shoe: 42 },
        lifecycleStage: 'MEMBER',
        membershipId: 'mem-1',
        firstSource: 'instagram',
      });
      prisma.contact.findFirst.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === 's' ? survivor : loser),
      );
      prisma.contact.findFirstOrThrow.mockResolvedValue({ ...survivor, pipelineStage: null, ownerMembership: null });
      const service = new ContactsService(
        prisma as unknown as PrismaService,
        pipeline as unknown as PipelineService,
        attribution as unknown as AttributionService,
      );

      await service.merge(tenant, 'user-1', { survivorId: 's', mergedId: 'm' });

      const [first, second] = tx.contact.update.mock.calls.map((c) => c[0]);
      expect(first).toEqual({ where: { id: 'm' }, data: { mergedIntoId: 's', membershipId: null } });
      expect(second.where).toEqual({ id: 's' });
      expect(second.data.email).toBe('ada@example.com');
      expect(second.data.phone).toBe('+905320000001');
      expect(second.data.membershipId).toBe('mem-1');
      expect(second.data.lifecycleStage).toBe('MEMBER');
      expect(second.data.tags).toEqual(['vip', 'referral']);
      expect(second.data.customFields).toEqual({ goal: 'strength', shoe: 42 });
      expect(second.data.firstSource).toBe('instagram');
      for (const model of [tx.contactActivity, tx.contactTask, tx.visitor, tx.touchpoint, tx.conversionEvent]) {
        expect(model.updateMany).toHaveBeenCalledWith({ where: { studioId: STUDIO, contactId: 'm' }, data: { contactId: 's' } });
      }
      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'contact.merge', entityId: 's', userId: 'user-1' }) }),
      );
      expect(attribution.refreshContactTouches).toHaveBeenCalledWith(STUDIO, 's');
    });

    it('refuses to merge two contacts that both have a member account', async () => {
      const { prisma, tx } = makePrisma();
      prisma.contact.findFirst.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(contact(where.id, { membershipId: `mem-${where.id}` })),
      );
      const service = new ContactsService(
        prisma as unknown as PrismaService,
        pipeline as unknown as PipelineService,
        attribution as unknown as AttributionService,
      );
      await expect(service.merge(tenant, 'user-1', { survivorId: 'a', mergedId: 'b' })).rejects.toBeInstanceOf(ConflictException);
      expect(tx.contact.update).not.toHaveBeenCalled();
    });
  });

  describe('resolveOrCreate', () => {
    it('returns the phone match and fills its missing email', async () => {
      const { prisma } = makePrisma();
      const existing = contact('c1', { phone: '+905320000002' });
      prisma.contact.findFirst
        .mockResolvedValueOnce(existing) // by phone
        .mockResolvedValueOnce(null); // email not taken
      prisma.contact.findUniqueOrThrow.mockResolvedValue({ ...existing, email: 'a@example.com' });
      const service = new ContactsService(
        prisma as unknown as PrismaService,
        pipeline as unknown as PipelineService,
        attribution as unknown as AttributionService,
      );
      const result = await service.resolveOrCreate(STUDIO, { firstName: 'A', phone: '+905320000002', email: 'a@example.com' });
      expect(result.created).toBe(false);
      expect(prisma.contact.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { email: 'a@example.com' } });
      expect(prisma.contact.create).not.toHaveBeenCalled();
    });

    it('creates a new contact without the email when the email belongs to someone with another phone', async () => {
      const { prisma } = makePrisma();
      prisma.contact.findFirst
        .mockResolvedValueOnce(null) // by phone
        .mockResolvedValueOnce(contact('other', { phone: '+905320000009', email: 'family@example.com' })) // by email
        .mockResolvedValueOnce({ id: 'other' }); // email taken
      prisma.contact.create.mockImplementation(({ data }) => Promise.resolve({ id: 'new', ...data }));
      const service = new ContactsService(
        prisma as unknown as PrismaService,
        pipeline as unknown as PipelineService,
        attribution as unknown as AttributionService,
      );
      const result = await service.resolveOrCreate(STUDIO, { firstName: 'B', phone: '+905320000003', email: 'family@example.com' });
      expect(result.created).toBe(true);
      expect(prisma.contact.create.mock.calls[0][0].data.email).toBeNull();
      expect(prisma.contact.create.mock.calls[0][0].data.phone).toBe('+905320000003');
    });
  });

  it('normalises and de-duplicates tags', () => {
    expect(dedupeTags(['VIP', ' vip ', 'Yeni  Uye', '###'])).toEqual(['vip', 'yeni uye']);
  });

  it('searches "first last" across both name columns', () => {
    const where = searchFilter('Deniz Kaya');
    expect(JSON.stringify(where)).toContain('"lastName":{"contains":"Kaya"');
    expect(JSON.stringify(where)).toContain('"firstName":{"contains":"Deniz"');
  });
});
