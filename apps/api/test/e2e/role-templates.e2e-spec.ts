import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaClient } from '@platform/database';
import { AppModule } from '../../src/app.module';

/**
 * 2.3: role templates (permission sets) and staff role assignment. Owner
 * role is read-only and always has every permission; roles.manage gates
 * everything here. Restores everything it creates or moves.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
const OWNER_PHONE = '+905321000002';
const TRAINER_PHONE = '+905321000004';
const RECEPTION_PHONE = '+905321000003';

describe('Role templates (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: any;

  let ZEN: string;
  let ownerToken: string;
  let trainerToken: string;
  let receptionToken: string;

  let trainerRoleId: string;
  let receptionRoleId: string;
  let ownerRoleId: string;
  let trainerMembershipId: string;

  const createdRoleIds: string[] = [];

  const login = async (phone: string) => {
    const res = await request(server).post('/auth/login').send({ emailOrPhone: phone, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  };
  const as = (token: string) => ({
    get: (url: string) => request(server).get(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', ZEN),
    post: (url: string) => request(server).post(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', ZEN),
    put: (url: string) => request(server).put(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', ZEN),
    delete: (url: string) => request(server).delete(url).set('Authorization', `Bearer ${token}`).set('x-studio-id', ZEN),
  });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = new PrismaClient();

    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    trainerRoleId = (await prisma.roleTemplate.findUniqueOrThrow({ where: { studioId_key: { studioId: ZEN, key: 'trainer' } } })).id;
    receptionRoleId = (await prisma.roleTemplate.findUniqueOrThrow({ where: { studioId_key: { studioId: ZEN, key: 'reception' } } })).id;
    ownerRoleId = (await prisma.roleTemplate.findUniqueOrThrow({ where: { studioId_key: { studioId: ZEN, key: 'owner' } } })).id;
    trainerMembershipId = (await prisma.membership.findFirstOrThrow({ where: { studioId: ZEN, user: { phone: TRAINER_PHONE } } })).id;

    ownerToken = await login(OWNER_PHONE);
    trainerToken = await login(TRAINER_PHONE);
    receptionToken = await login(RECEPTION_PHONE);
  });

  afterAll(async () => {
    await prisma.membership.update({ where: { id: trainerMembershipId }, data: { roleTemplateId: trainerRoleId } });
    await prisma.roleTemplatePermission.deleteMany({ where: { roleTemplateId: { in: createdRoleIds } } });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ entityId: { in: [...createdRoleIds, trainerMembershipId] } }, { action: { startsWith: 'role_template.' }, studioId: ZEN }] },
    });
    await prisma.roleTemplate.deleteMany({ where: { id: { in: createdRoleIds } } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('catalogue', () => {
    it('owner lists role templates with resolved permissions', async () => {
      const res = await as(ownerToken).get(`/role-templates/studio/${ZEN}`);
      expect(res.status).toBe(200);
      const owner = res.body.find((r: any) => r.key === 'owner');
      expect(owner.isOwner).toBe(true);
      expect(owner.permissions).toEqual(expect.arrayContaining(['roles.manage', 'finance.manage']));
      const trainer = res.body.find((r: any) => r.key === 'trainer');
      expect(trainer.permissions).toEqual(expect.arrayContaining(['schedule.view', 'attendance.manage']));
    });

    it('trainer without roles.manage -> 403', async () => {
      const res = await as(trainerToken).get(`/role-templates/studio/${ZEN}`);
      expect(res.status).toBe(403);
    });

    it('owner creates a role with a chosen permission set', async () => {
      const res = await as(ownerToken)
        .post('/role-templates')
        .send({ studioId: ZEN, name: `E2E Rol ${Date.now().toString(36)}`, permissions: ['schedule.view', 'members.view'] });
      expect(res.status).toBe(201);
      expect(res.body.permissions.sort()).toEqual(['members.view', 'schedule.view']);
      createdRoleIds.push(res.body.id);
    });

    it('owner edits the role permissions', async () => {
      const id = createdRoleIds[0];
      const res = await as(ownerToken).put(`/role-templates/${id}`).send({ permissions: ['members.view'] });
      expect(res.status).toBe(200);
      expect(res.body.permissions).toEqual(['members.view']);
    });

    it('the owner role cannot be edited or deleted', async () => {
      const edit = await as(ownerToken).put(`/role-templates/${ownerRoleId}`).send({ name: 'Baska isim' });
      expect(edit.status).toBe(400);
      const del = await as(ownerToken).delete(`/role-templates/${ownerRoleId}`);
      expect(del.status).toBe(400);
    });

    it('a role in use cannot be deleted', async () => {
      const res = await as(ownerToken).delete(`/role-templates/${trainerRoleId}`);
      expect(res.status).toBe(409);
    });

    it('an unused role can be deleted', async () => {
      const id = createdRoleIds.pop();
      const res = await as(ownerToken).delete(`/role-templates/${id}`);
      expect(res.status).toBe(200);
    });
  });

  describe('staff role assignment', () => {
    it('lists staff memberships with their current role', async () => {
      const res = await as(ownerToken).get(`/role-templates/studio/${ZEN}/staff`);
      expect(res.status).toBe(200);
      const trainer = res.body.find((m: any) => m.membershipId === trainerMembershipId);
      expect(trainer.roleTemplateId).toBe(trainerRoleId);
      expect(res.body.every((m: any) => m.isOwner === (m.roleTemplateId === ownerRoleId))).toBe(true);
    });

    it('owner moves a trainer to the reception role; trainer without roles.manage -> 403', async () => {
      const denied = await as(trainerToken).put(`/role-templates/staff/${trainerMembershipId}`).send({ roleTemplateId: receptionRoleId });
      expect(denied.status).toBe(403);

      const res = await as(ownerToken).put(`/role-templates/staff/${trainerMembershipId}`).send({ roleTemplateId: receptionRoleId });
      expect(res.status).toBe(200);
      expect(res.body.roleTemplateId).toBe(receptionRoleId);
    });

    it('the owner role cannot be assigned via this endpoint', async () => {
      const res = await as(ownerToken).put(`/role-templates/staff/${trainerMembershipId}`).send({ roleTemplateId: ownerRoleId });
      expect(res.status).toBe(400);
    });

    it('reception (no roles.manage) cannot assign roles', async () => {
      const res = await as(receptionToken).put(`/role-templates/staff/${trainerMembershipId}`).send({ roleTemplateId: trainerRoleId });
      expect(res.status).toBe(403);
    });
  });

  describe('privilege boundaries for non-owner managers', () => {
    let managerRoleId: string;
    let receptionMembershipId: string;
    let memberRoleId: string;

    beforeAll(async () => {
      receptionMembershipId = (await prisma.membership.findFirstOrThrow({ where: { studioId: ZEN, user: { phone: RECEPTION_PHONE } } })).id;
      memberRoleId = (await prisma.roleTemplate.findUniqueOrThrow({ where: { studioId_key: { studioId: ZEN, key: 'member' } } })).id;
      const created = await as(ownerToken)
        .post('/role-templates')
        .send({ studioId: ZEN, name: `Sinirli yonetici ${Date.now().toString(36)}`, permissions: ['roles.manage', 'members.view'] });
      expect(created.status).toBe(201);
      managerRoleId = created.body.id;
      createdRoleIds.push(managerRoleId);
      const moved = await as(ownerToken).put(`/role-templates/staff/${trainerMembershipId}`).send({ roleTemplateId: managerRoleId });
      expect(moved.status).toBe(200);
    });

    it('cannot create a role with a permission the manager does not hold', async () => {
      const res = await as(trainerToken)
        .post('/role-templates')
        .send({ studioId: ZEN, name: `Yetki yukseltme ${Date.now().toString(36)}`, permissions: ['members.view', 'reports.view'] });
      expect(res.status).toBe(403);
    });

    it('can create a role within its own permissions', async () => {
      const res = await as(trainerToken)
        .post('/role-templates')
        .send({ studioId: ZEN, name: `Alt rol ${Date.now().toString(36)}`, permissions: ['members.view'] });
      expect(res.status).toBe(201);
      createdRoleIds.push(res.body.id);
    });

    it('cannot change its own role', async () => {
      const res = await as(trainerToken).put(`/role-templates/staff/${trainerMembershipId}`).send({ roleTemplateId: managerRoleId });
      expect(res.status).toBe(403);
    });

    it('cannot reassign staff whose current role holds permissions the manager lacks', async () => {
      const res = await as(trainerToken).put(`/role-templates/staff/${receptionMembershipId}`).send({ roleTemplateId: managerRoleId });
      expect(res.status).toBe(403);
    });

    it('cannot edit the member role', async () => {
      const res = await as(trainerToken).put(`/role-templates/${memberRoleId}`).send({ permissions: ['members.view'] });
      expect([403, 404]).toContain(res.status);
    });
  });
});
