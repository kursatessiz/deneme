import { PrismaClient } from '@platform/database';
import { DEFAULT_PIPELINE_STAGES } from '@platform/shared';

/**
 * G1b data migration (20260929000000_crm_attribution). The seed writes a
 * few legacy `leads` rows and then runs the same crm_backfill_contacts()
 * SQL the migration ran on production data, so these assertions check the
 * migration against the seeded database: leads and members became
 * contacts with the right stages, nothing is duplicated, every studio has
 * the default pipeline, the platform tenant exists and the function is
 * idempotent. The last block runs the function again on freshly inserted
 * legacy rows in a throwaway studio.
 */

const SEED_OPEN_LEAD_PHONE = '+905399960001';
const SEED_FLOW_TRIAL_PHONE = '+905399960002';
/** Seed users are generated as +905321000xxx (packages/database/prisma/seed.ts). */
const SEED_PHONE_PREFIX = '+905321000';

describe('CRM data migration (e2e)', () => {
  let prisma: PrismaClient;
  let ZEN: string;
  let FLOW: string;
  const tempSlug = 'e2e-crm-migration';

  beforeAll(async () => {
    prisma = new PrismaClient();
    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    FLOW = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'flow-pilates-wellness' } })).id;
    await prisma.studio.deleteMany({ where: { slug: tempSlug } });
  });

  afterAll(async () => {
    await prisma.studio.deleteMany({ where: { slug: tempSlug } });
    await prisma.$disconnect();
  });

  it('every studio has the default pipeline stages', async () => {
    const studios = await prisma.studio.findMany({ include: { pipelineStages: { where: { isSystem: true } } } });
    for (const studio of studios) {
      expect(studio.pipelineStages.map((s) => s.key).sort()).toEqual(DEFAULT_PIPELINE_STAGES.map((s) => s.key).sort());
    }
  });

  it('exactly one platform tenant exists, with slug platform', async () => {
    const platforms = await prisma.studio.findMany({ where: { isPlatform: true } });
    expect(platforms).toHaveLength(1);
    expect(platforms[0].slug).toBe('platform');
    await expect(
      prisma.studio.create({ data: { name: 'Second platform', slug: `${tempSlug}-p`, isPlatform: true } }),
    ).rejects.toThrow();
  });

  it('two leads with the same phone became one contact keeping the open lead id, stage, source and activities', async () => {
    const openLead = await prisma.lead.findFirstOrThrow({ where: { studioId: ZEN, phone: SEED_OPEN_LEAD_PHONE, openPhone: { not: null } } });
    const contacts = await prisma.contact.findMany({
      where: { studioId: ZEN, phone: SEED_OPEN_LEAD_PHONE },
      include: { pipelineStage: true, activities: true },
    });
    expect(contacts).toHaveLength(1);
    const [c] = contacts;
    expect(c.id).toBe(openLead.id);
    expect(c.firstName).toBe('Seda Nur');
    expect(c.lastName).toBe('Aksoy');
    expect(c.email).toBe('seda.aksoy@example.com');
    expect(c.lifecycleStage).toBe('LEAD');
    expect(c.pipelineStage?.key).toBe('CONTACTED');
    expect(c.sourceChannel).toBe('WEB_FORM');
    expect(c.firstSource).toBe('instagram');
    expect(c.lastSource).toBe('instagram');
    expect(c.firstMedium).toBe('paid_social');
    expect(c.firstCampaignName).toBe('tr_tr_pilates_lead_202609');
    const bodies = c.activities.map((a) => a.body);
    expect(bodies).toEqual(expect.arrayContaining(['Arandi, fiyat bilgisi verildi', 'Eski basvuru']));
    expect(c.activities.filter((a) => a.type === 'MERGE')).toHaveLength(1);
  });

  it('a lead for an existing member was linked to that membership and is MEMBER', async () => {
    const memberLeads = await prisma.lead.findMany({ where: { studioId: ZEN, phone: { startsWith: SEED_PHONE_PREFIX } } });
    expect(memberLeads.length).toBe(2);
    for (const lead of memberLeads) {
      const contact = await prisma.contact.findFirstOrThrow({ where: { studioId: ZEN, phone: lead.phone }, include: { pipelineStage: true } });
      const membership = await prisma.membership.findFirstOrThrow({ where: { studioId: ZEN, user: { phone: lead.phone } } });
      expect(contact.membershipId).toBe(membership.id);
      expect(contact.lifecycleStage).toBe('MEMBER');
      expect(contact.pipelineStage?.key).toBe(lead.stage);
    }
  });

  it('a TRIAL_BOOKED lead became a TRIAL contact on the TRIAL_BOOKED stage', async () => {
    const contact = await prisma.contact.findFirstOrThrow({ where: { studioId: FLOW, phone: SEED_FLOW_TRIAL_PHONE }, include: { pipelineStage: true } });
    expect(contact.lifecycleStage).toBe('TRIAL');
    expect(contact.pipelineStage?.key).toBe('TRIAL_BOOKED');
    expect(contact.sourceChannel).toBe('INSTAGRAM');
  });

  it('every seeded member membership has exactly one linked contact, MEMBER or LAPSED', async () => {
    const memberships = await prisma.membership.findMany({
      where: { memberProfile: { isNot: null }, isPartnerGuest: false, user: { phone: { startsWith: SEED_PHONE_PREFIX } } },
      include: { user: true, contact: true },
    });
    expect(memberships.length).toBeGreaterThan(10);
    for (const m of memberships) {
      expect(m.contact).not.toBeNull();
      expect(m.contact!.studioId).toBe(m.studioId);
      expect(m.contact!.phone).toBe(m.user.phone);
      expect(['MEMBER', 'LAPSED']).toContain(m.contact!.lifecycleStage);
    }
  });

  it('no studio has two unmerged contacts with the same phone or email', async () => {
    const phones = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM (
        SELECT studio_id, phone FROM contacts WHERE merged_into_id IS NULL AND phone IS NOT NULL
        GROUP BY studio_id, phone HAVING count(*) > 1) d`;
    expect(Number(phones[0].n)).toBe(0);
    const emails = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM (
        SELECT studio_id, lower(email) FROM contacts WHERE merged_into_id IS NULL AND email IS NOT NULL
        GROUP BY studio_id, lower(email) HAVING count(*) > 1) d`;
    expect(Number(emails[0].n)).toBe(0);
  });

  it('role templates that manage leads also carry the CRM keys', async () => {
    const templates = await prisma.roleTemplate.findMany({ include: { permissions: true } });
    for (const t of templates) {
      const keys = new Set(t.permissions.map((p) => p.permissionKey));
      if (keys.has('leads.view')) expect(keys.has('crm.view')).toBe(true);
      if (keys.has('leads.manage')) expect(keys.has('crm.manage')).toBe(true);
    }
  });

  it('running the backfill again changes nothing', async () => {
    const seeded = {
      OR: [{ phone: { startsWith: SEED_PHONE_PREFIX } }, { phone: { in: [SEED_OPEN_LEAD_PHONE, SEED_FLOW_TRIAL_PHONE] } }],
    };
    const counts = () =>
      Promise.all([
        prisma.contact.count({ where: seeded }),
        prisma.contactActivity.count({ where: { contact: seeded } }),
        prisma.pipelineStage.count({ where: { studio: { slug: { in: ['zen-reformer-pilates', 'flow-pilates-wellness', 'platform'] } } } }),
      ]);
    const before = await counts();
    await prisma.$executeRawUnsafe('SELECT crm_backfill_contacts()');
    const after = await counts();
    expect(after).toEqual(before);
  });

  it('migrates fresh legacy rows: dedupes by phone, keeps email unique, maps stages', async () => {
    const studio = await prisma.studio.create({ data: { name: 'E2E migration', slug: tempSlug } });
    const open = await prisma.lead.create({
      data: { studioId: studio.id, fullName: 'Tek Isim', phone: '+905399950001', openPhone: '+905399950001', email: 'Same@Example.com', source: 'PHONE', stage: 'NEW' },
    });
    await prisma.lead.create({
      data: { studioId: studio.id, fullName: 'Tek Isim Eski', phone: '+905399950001', source: 'OTHER', stage: 'WON' },
    });
    const other = await prisma.lead.create({
      data: { studioId: studio.id, fullName: 'Baska Kisi', phone: '+905399950002', openPhone: '+905399950002', email: 'same@example.com', source: 'OTHER', stage: 'TRIAL_DONE' },
    });
    await prisma.leadActivity.create({ data: { leadId: open.id, studioId: studio.id, type: 'NOTE', body: 'e2e migrated note' } });

    await prisma.$executeRawUnsafe('SELECT crm_backfill_contacts()');

    const stages = await prisma.pipelineStage.count({ where: { studioId: studio.id } });
    expect(stages).toBe(DEFAULT_PIPELINE_STAGES.length);
    const contacts = await prisma.contact.findMany({ where: { studioId: studio.id }, include: { pipelineStage: true, activities: true }, orderBy: { phone: 'asc' } });
    expect(contacts.map((c) => c.phone)).toEqual(['+905399950001', '+905399950002']);
    expect(contacts[0].id).toBe(open.id);
    expect(contacts[0].firstName).toBe('Tek');
    expect(contacts[0].lastName).toBe('Isim');
    expect(contacts[0].pipelineStage?.key).toBe('NEW');
    expect(contacts[0].email).toBe('Same@Example.com');
    expect(contacts[0].activities.map((a) => a.body)).toContain('e2e migrated note');
    expect(contacts[1].id).toBe(other.id);
    expect(contacts[1].email).toBeNull();
    expect(contacts[1].lifecycleStage).toBe('TRIAL');
    expect(contacts[1].pipelineStage?.key).toBe('TRIAL_DONE');
  });
});
