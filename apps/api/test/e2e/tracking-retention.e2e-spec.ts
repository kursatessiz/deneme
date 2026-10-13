import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';
import { TrackingRetentionService } from '../../src/modules/crm/tracking/tracking-retention.service';

/**
 * Touchpoint and visitor retention (docs/CRM_VE_ATIF.md): rows older than 13
 * months go, recent ones stay, the contact attribution summary survives the
 * ON DELETE SET NULL of its first/last touchpoint references, and a visitor
 * linked to a contact is kept.
 */
describe('Tracking retention (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let retention: TrackingRetentionService;
  let studioId: string;
  const now = new Date();
  const old = new Date(now.getTime() - 14 * 31 * 24 * 60 * 60 * 1000);
  const recent = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const contactIds: string[] = [];
  const visitorIds: string[] = [];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new PrismaClient();
    retention = app.get(TrackingRetentionService);
    studioId = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
  });

  afterAll(async () => {
    await prisma.visitor.deleteMany({ where: { studioId, id: { in: visitorIds } } });
    await prisma.contact.deleteMany({ where: { id: { in: contactIds } } });
    await prisma.$disconnect();
    await app.close();
  });

  const touch = (visitorId: string, occurredAt: Date, contactId?: string) =>
    prisma.touchpoint.create({
      data: { studioId, visitorId, sessionId: randomUUID(), occurredAt, landingPath: '/e2e-retention', utmSource: 'retention-src', contactId: contactId ?? null },
    });

  it('deletes old rows, keeps recent and linked ones, and keeps the contact summary', async () => {
    const contact = await prisma.contact.create({
      data: { studioId, firstName: 'E2E retention', firstSource: 'retention-src', lastSource: 'retention-src' },
    });
    contactIds.push(contact.id);
    const anon = randomUUID();
    const linked = randomUUID();
    const fresh = randomUUID();
    visitorIds.push(anon, linked, fresh);
    await prisma.visitor.createMany({
      data: [
        { id: anon, studioId, firstSeenAt: old, lastSeenAt: old },
        { id: linked, studioId, firstSeenAt: old, lastSeenAt: old, contactId: contact.id },
        { id: fresh, studioId, firstSeenAt: old, lastSeenAt: recent },
      ],
    });
    const oldAnon = await touch(anon, old);
    const oldLinked = await touch(linked, old, contact.id);
    const recentFresh = await touch(fresh, recent);
    await prisma.contact.update({ where: { id: contact.id }, data: { firstTouchpointId: oldLinked.id, lastTouchpointId: oldLinked.id } });

    const result = await retention.run(now);
    expect(result.ran).toBe(true);

    expect(await prisma.touchpoint.findUnique({ where: { id: oldAnon.id } })).toBeNull();
    expect(await prisma.touchpoint.findUnique({ where: { id: oldLinked.id } })).toBeNull();
    expect(await prisma.touchpoint.findUnique({ where: { id: recentFresh.id } })).not.toBeNull();
    expect(await prisma.visitor.findUnique({ where: { studioId_id: { studioId, id: anon } } })).toBeNull();
    expect(await prisma.visitor.findUnique({ where: { studioId_id: { studioId, id: linked } } })).not.toBeNull();
    expect(await prisma.visitor.findUnique({ where: { studioId_id: { studioId, id: fresh } } })).not.toBeNull();

    const after = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(after.firstTouchpointId).toBeNull();
    expect(after.lastTouchpointId).toBeNull();
    expect(after.firstSource).toBe('retention-src');
    expect(after.lastSource).toBe('retention-src');
  });
});
