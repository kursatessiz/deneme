import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@platform/database';
import type { PrismaService } from '../../prisma/prisma.service';
import { SegmentEvaluatorService } from './segment-evaluator.service';
import { effectiveConsent } from '../../notifications/consent/contact-consent.service';

const STUDIO = '0b0b0b0b-0000-4000-8000-000000000001';
const NOW = new Date('2026-06-01T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function build(customKinds: Record<string, string> = {}) {
  const prisma = {
    contactFieldDefinition: { findMany: jest.fn(async () => Object.entries(customKinds).map(([key, kind]) => ({ key, kind }))) },
    $queryRaw: jest.fn(async () => [{ id: 'c-1' }, { id: 'c-2' }]),
    studio: { findUnique: jest.fn(async () => ({ timezone: 'Europe/Istanbul' })) },
  };
  return { service: new SegmentEvaluatorService(prisma as unknown as PrismaService), prisma };
}

describe('SegmentEvaluatorService', () => {
  it('always scopes by studio and hides merged contacts', async () => {
    const { service } = build();
    const where = await service.where(STUDIO, { combinator: 'and', rules: [{ field: 'contact.locale', op: 'eq', value: 'en' }] }, NOW);
    expect(where).toEqual({ studioId: STUDIO, mergedIntoId: null, AND: [{ AND: [{ locale: { equals: 'en' } }] }] });
  });

  it('compiles tags, lifecycle and OR groups into Prisma filters', async () => {
    const { service } = build();
    const where = await service.where(
      STUDIO,
      {
        combinator: 'or',
        rules: [
          { field: 'contact.tags', op: 'has_none', value: ['VIP '] },
          { field: 'contact.lifecycleStage', op: 'not_in', value: ['LOST'] },
        ],
      },
      NOW,
    );
    expect(where.AND).toEqual([{ OR: [{ NOT: { tags: { hasSome: ['vip'] } } }, { NOT: { lifecycleStage: { in: ['LOST'] } } }] }]);
  });

  it('expresses "days since last attendance" with relation filters', async () => {
    const { service } = build();
    const where = await service.where(STUDIO, { combinator: 'and', rules: [{ field: 'activity.lastAttendedDaysAgo', op: 'gt', value: 30 }] }, NOW);
    const recent = { membership: { is: { memberProfile: { is: { bookings: { some: { status: 'ATTENDED', schedule: { startTime: { gte: new Date(NOW.getTime() - 30 * DAY), lte: NOW } } } } } } } } };
    const ever = { membership: { is: { memberProfile: { is: { bookings: { some: { status: 'ATTENDED', schedule: { startTime: { lte: NOW } } } } } } } } };
    expect(where.AND).toEqual([{ AND: [{ AND: [ever, { NOT: recent }] }] }]);
  });

  it('runs aggregates as a parameterised query and filters by the returned ids', async () => {
    const { service, prisma } = build();
    const where = await service.where(STUDIO, { combinator: 'and', rules: [{ field: 'activity.attendedTotal', op: 'gte', value: 3 }] }, NOW);
    expect(where.AND).toEqual([{ AND: [{ id: { in: ['c-1', 'c-2'] } }] }]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    // The rule value travels as a bind parameter, never as SQL text.
    const [strings, ...values] = prisma.$queryRaw.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]];
    const sql = Prisma.sql(strings, ...values);
    expect(sql.values).toContain(3);
    expect(sql.values).toContain(STUDIO);
  });

  it('uses JSON path filters for custom fields', async () => {
    const { service } = build({ goal: 'string', visits: 'number' });
    const where = await service.where(
      STUDIO,
      {
        combinator: 'and',
        rules: [
          { field: 'custom.goal', op: 'eq', value: 'strength' },
          { field: 'custom.visits', op: 'gt', value: 5 },
        ],
      },
      NOW,
    );
    expect(where.AND).toEqual([{ AND: [{ customFields: { path: ['goal'], equals: 'strength' } }, { customFields: { path: ['visits'], gt: 5 } }] }]);
  });

  it('answers the loyalty balance (G3a) with a studio-scoped parameterised query', async () => {
    const { service, prisma } = build();
    const where = await service.where(STUDIO, { combinator: 'and', rules: [{ field: 'loyalty.pointsBalance', op: 'gte', value: 100 }] }, NOW);
    expect(where.AND).toEqual([{ AND: [{ id: { in: ['c-1', 'c-2'] } }] }]);
    const [strings, ...values] = prisma.$queryRaw.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]];
    const sql = Prisma.sql(strings, ...values);
    expect(sql.sql).toContain('loyalty_accounts');
    expect(sql.values).toContain(100);
    expect(sql.values).toContain(STUDIO);
  });

  it('rejects invalid fields and operators before touching the database', async () => {
    const { service, prisma } = build();
    await expect(service.validate(STUDIO, { combinator: 'and', rules: [{ field: 'contact.nope', op: 'eq', value: 1 }] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.validate(STUDIO, { combinator: 'and', rules: [{ field: 'loyalty.pointsBalance', op: 'contains', value: 1 }] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.validate(STUDIO, { combinator: 'and', rules: [{ field: 'contact.x; drop', op: 'eq', value: 1 }] })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('effectiveConsent', () => {
  const row = (status: 'GRANTED' | 'REVOKED', at: string) => ({
    status,
    grantedAt: status === 'GRANTED' ? new Date(at) : null,
    revokedAt: status === 'REVOKED' ? new Date(at) : null,
    updatedAt: new Date(at),
  });

  it('defaults to no consent', () => {
    expect(effectiveConsent(null, null)).toEqual({ granted: false, decidedBy: 'default' });
  });

  it('the most recent decision wins', () => {
    expect(effectiveConsent(row('GRANTED', '2026-01-01'), row('REVOKED', '2026-02-01'))).toEqual({ granted: false, decidedBy: 'member' });
    expect(effectiveConsent(row('REVOKED', '2026-03-01'), row('GRANTED', '2026-02-01'))).toEqual({ granted: false, decidedBy: 'contact' });
    expect(effectiveConsent(row('GRANTED', '2026-03-01'), null)).toEqual({ granted: true, decidedBy: 'contact' });
  });
});
