import { BadRequestException } from '@nestjs/common';
import { LeadStage } from '@platform/shared';
import { LeadsCompatService } from './leads-compat.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ContactsService } from '../contacts/contacts.service';
import type { PipelineService } from '../pipeline/pipeline.service';
import type { ConversionService } from '../conversions/conversion.service';
import type { AttributionService } from '../attribution/attribution.service';
import type { CrmHooksService } from '../hooks/crm-hooks.service';
import type { MembersService } from '../../members/members.service';
import type { SchedulesService } from '../../schedules/schedules.service';
import type { TenantContext } from '../../auth/tenant-context';

const STUDIO = 'studio-1';
const tenant: TenantContext = {
  studioId: STUDIO,
  membershipId: 'staff-1',
  isOwner: false,
  isSuperAdmin: false,
  permissions: new Set(['leads.view', 'leads.manage']),
  memberProfileId: null,
  trainerProfileId: null,
  branchIds: null,
};

describe('LeadsCompatService (deprecated /leads wrappers over contacts)', () => {
  const prisma = {
    contact: { findFirst: jest.fn(), findFirstOrThrow: jest.fn(), update: jest.fn() },
    contactActivity: { create: jest.fn() },
    pipelineStage: { findUnique: jest.fn() },
    studio: { findFirst: jest.fn() },
  };
  const contacts = { getOwn: jest.fn(), moveToStage: jest.fn(), resolveOrCreate: jest.fn(), assertStaffMembership: jest.fn() };
  const conversions = { recordSafely: jest.fn() };
  const attribution = { identify: jest.fn() };

  const service = new LeadsCompatService(
    prisma as unknown as PrismaService,
    contacts as unknown as ContactsService,
    {} as PipelineService,
    conversions as unknown as ConversionService,
    attribution as unknown as AttributionService,
    {} as CrmHooksService,
    {} as MembersService,
    {} as SchedulesService,
  );

  const leadRow = (stage: { key: string; kind: string } | null) => ({
    id: 'lead-1',
    studioId: STUDIO,
    branchId: null,
    firstName: 'Ayse',
    lastName: 'Yilmaz',
    phone: '+905399990001',
    email: null,
    sourceChannel: 'PHONE',
    sourceDetail: null,
    interestServiceTypeId: null,
    interestServiceType: null,
    pipelineStage: stage,
    lostReason: null,
    ownerMembershipId: null,
    ownerMembership: null,
    nextFollowUpAt: null,
    membershipId: null,
    firstSource: null,
    firstMedium: null,
    firstCampaignName: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  beforeEach(() => jest.clearAllMocks());

  describe('changeStage', () => {
    it('rejects moving away from WON', async () => {
      contacts.getOwn.mockResolvedValueOnce({ id: 'lead-1', studioId: STUDIO, pipelineStageId: 'st-won', branchId: null });
      prisma.pipelineStage.findUnique.mockResolvedValueOnce({ id: 'st-won', key: 'WON', kind: 'WON' });
      await expect(service.changeStage(tenant, 'lead-1', { stage: LeadStage.CONTACTED })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(contacts.moveToStage).not.toHaveBeenCalled();
    });

    it('rejects a backward transition (TRIAL_BOOKED -> NEW)', async () => {
      contacts.getOwn.mockResolvedValueOnce({ id: 'lead-1', studioId: STUDIO, pipelineStageId: 'st-tb' });
      prisma.pipelineStage.findUnique.mockResolvedValueOnce({ id: 'st-tb', key: 'TRIAL_BOOKED', kind: 'OPEN' });
      await expect(service.changeStage(tenant, 'lead-1', { stage: LeadStage.NEW })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows NEW -> CONTACTED and keeps the legacy response shape', async () => {
      contacts.getOwn.mockResolvedValueOnce({ id: 'lead-1', studioId: STUDIO, pipelineStageId: 'st-new' });
      prisma.pipelineStage.findUnique.mockResolvedValueOnce({ id: 'st-new', key: 'NEW', kind: 'OPEN' });
      prisma.contact.findFirstOrThrow.mockResolvedValueOnce(leadRow({ key: 'CONTACTED', kind: 'OPEN' }));
      const dto = await service.changeStage(tenant, 'lead-1', { stage: LeadStage.CONTACTED });
      expect(contacts.moveToStage).toHaveBeenCalledWith(expect.objectContaining({ id: 'lead-1' }), 'CONTACTED', expect.anything());
      expect(dto).toEqual(
        expect.objectContaining({ id: 'lead-1', stage: 'CONTACTED', fullName: 'Ayse Yilmaz', source: 'PHONE', convertedMembershipId: null }),
      );
    });

    it('stores the lost reason when moving to LOST', async () => {
      contacts.getOwn.mockResolvedValueOnce({ id: 'lead-1', studioId: STUDIO, pipelineStageId: null });
      prisma.contact.findFirstOrThrow.mockResolvedValueOnce(leadRow({ key: 'LOST', kind: 'LOST' }));
      await service.changeStage(tenant, 'lead-1', { stage: LeadStage.LOST, lostReason: 'Fiyat' });
      expect(contacts.moveToStage).toHaveBeenCalledWith(expect.anything(), 'LOST', expect.objectContaining({ lostReason: 'Fiyat' }));
    });
  });

  describe('create dedupe', () => {
    it('folds a submission for a phone with an open pipeline card into an activity', async () => {
      prisma.contact.findFirst.mockResolvedValueOnce({ id: 'lead-1', pipelineStage: { key: 'NEW', kind: 'OPEN' } });
      prisma.contactActivity.create.mockResolvedValueOnce({
        id: 'a1',
        contactId: 'lead-1',
        studioId: STUDIO,
        type: 'NOTE',
        body: 'x',
        actorMembershipId: 'staff-1',
        createdAt: new Date(),
      });
      prisma.contact.findFirstOrThrow.mockResolvedValueOnce(leadRow({ key: 'NEW', kind: 'OPEN' }));
      const result = await service.create(tenant, {
        studioId: STUDIO,
        fullName: 'Ayse Yilmaz',
        phone: '+905399990001',
        source: 'PHONE',
      } as never);
      expect(result.deduplicated).toBe(true);
      expect(contacts.resolveOrCreate).not.toHaveBeenCalled();
      expect(conversions.recordSafely).not.toHaveBeenCalled();
    });

    it('creates a contact on the NEW stage and records the lead conversion', async () => {
      prisma.contact.findFirst.mockResolvedValueOnce(null);
      contacts.resolveOrCreate.mockResolvedValueOnce({ contact: { id: 'c-new' }, created: true });
      prisma.contact.findFirstOrThrow.mockResolvedValueOnce(leadRow({ key: 'NEW', kind: 'OPEN' }));
      const result = await service.create(tenant, {
        studioId: STUDIO,
        fullName: 'Deniz Kaya',
        phone: '+905399990002',
        source: 'WALK_IN',
        utmSource: 'instagram',
      } as never);
      expect(result.deduplicated).toBe(false);
      expect(contacts.resolveOrCreate).toHaveBeenCalledWith(
        STUDIO,
        expect.objectContaining({ firstName: 'Deniz', lastName: 'Kaya', pipelineStageKey: 'NEW', sourceChannel: 'WALK_IN' }),
      );
      expect(conversions.recordSafely).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'lead', contactId: 'c-new', source: { kind: 'lead_contact', id: 'c-new' } }),
      );
    });
  });

  describe('public form', () => {
    it('does nothing for a honeypot hit', async () => {
      await service.submitPublicForm('zen', { fullName: 'Bot', phone: '+905399990004', consent: true, website: 'http://x' } as never, null);
      expect(prisma.studio.findFirst).not.toHaveBeenCalled();
    });

    it('does nothing for an unknown slug', async () => {
      prisma.studio.findFirst.mockResolvedValueOnce(null);
      await service.submitPublicForm('nope', { fullName: 'T', phone: '+905399990005', consent: true, website: '' } as never, null);
      expect(prisma.contact.findFirst).not.toHaveBeenCalled();
    });

    it('identifies the visitor on the new contact', async () => {
      prisma.studio.findFirst.mockResolvedValueOnce({ id: STUDIO });
      prisma.contact.findFirst.mockResolvedValueOnce(null);
      contacts.resolveOrCreate.mockResolvedValueOnce({ contact: { id: 'c-web' }, created: true });
      await service.submitPublicForm(
        'zen',
        { fullName: 'Web Aday', phone: '+905399990006', consent: true, website: '' } as never,
        'visitor-1',
      );
      expect(attribution.identify).toHaveBeenCalledWith(STUDIO, 'visitor-1', 'c-web');
      expect(conversions.recordSafely).toHaveBeenCalledWith(expect.objectContaining({ type: 'lead', contactId: 'c-web' }));
    });
  });
});
