import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';

/**
 * A staff member with integrations.manage may only create API keys whose
 * scopes their own permissions cover; the owner is unrestricted.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const OWNER_PHONE = '+905321000002';
const STAFF_PHONE = '+905329140001';

describe('API key scope escalation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let ZEN: string;
  let ownerToken: string;
  let staffToken: string;
  const createdKeyIds: string[] = [];

  const login = async (phone: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const createKey = (token: string, scopes: string[]) =>
    request(server).post('/integrations/api-keys').set('Authorization', `Bearer ${token}`).set('x-studio-id', ZEN).send({ name: 'E2E scope key', scopes });

  /** Removes the throwaway staff user, its keys and its role (also what an aborted earlier run left behind). */
  const cleanup = async () => {
    const users = await prisma.user.findMany({ where: { phone: STAFF_PHONE }, select: { id: true } });
    const userIds = users.map((u) => u.id);
    const keys = await prisma.apiKey.findMany({ where: { createdByUserId: { in: userIds } }, select: { id: true } });
    const keyIds = [...keys.map((k) => k.id), ...createdKeyIds];
    await prisma.auditLog.deleteMany({ where: { studioId: ZEN, entityId: { in: keyIds } } });
    await prisma.apiKey.deleteMany({ where: { id: { in: keyIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.roleTemplate.deleteMany({ where: { studioId: ZEN, key: 'e2e-apikey-staff' } });
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();
    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    await cleanup();

    const role = await prisma.roleTemplate.create({
      data: {
        studioId: ZEN,
        key: 'e2e-apikey-staff',
        name: 'E2E API key staff',
        permissions: { create: [{ permissionKey: 'integrations.manage' }, { permissionKey: 'schedule.view' }] },
      },
    });
    const user = await prisma.user.create({
      data: { phone: STAFF_PHONE, firstName: 'Key', lastName: 'Staff', passwordHash: await bcrypt.hash(DEMO_PASSWORD, 4), phoneVerifiedAt: new Date() },
    });
    await prisma.membership.create({ data: { userId: user.id, studioId: ZEN, roleTemplateId: role.id, status: 'ACTIVE', joinedAt: new Date() } });

    ownerToken = await login(OWNER_PHONE);
    staffToken = await login(STAFF_PHONE);
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  it('refuses scopes the creator does not hold the permissions for', async () => {
    const res = await createKey(staffToken, ['schedules.read', 'members.read']);
    expect(res.status).toBe(403);
    const crm = await createKey(staffToken, ['crm.write']);
    expect(crm.status).toBe(403);
  });

  it('allows scopes the creator holds', async () => {
    const res = await createKey(staffToken, ['schedules.read', 'webhooks.manage']);
    expect(res.status).toBe(201);
    createdKeyIds.push(res.body.id);
  });

  it('lets the owner grant every scope', async () => {
    const res = await createKey(ownerToken, ['schedules.read', 'bookings.read', 'bookings.write', 'members.read', 'webhooks.manage', 'crm.write']);
    expect(res.status).toBe(201);
    createdKeyIds.push(res.body.id);
  });
});
