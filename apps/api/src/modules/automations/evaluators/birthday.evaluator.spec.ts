import { BirthdayEvaluator } from './birthday.evaluator';
import { PrismaService } from '../../prisma/prisma.service';

describe('BirthdayEvaluator', () => {
  const now = new Date('2026-06-15T10:00:00.000Z');

  function buildPrisma(members: unknown[]) {
    return {
      memberProfile: { findMany: jest.fn().mockResolvedValue(members) },
      studio: { findUniqueOrThrow: jest.fn().mockResolvedValue({ name: 'Zen Reformer' }) },
    } as unknown as PrismaService;
  }

  it('matches a member whose birthday (month/day) is today', async () => {
    const prisma = buildPrisma([
      {
        id: 'member-1',
        birthDate: new Date('1990-06-15T00:00:00.000Z'),
        membership: { userId: 'user-1', user: { firstName: 'Selin' } },
      },
    ]);
    const evaluator = new BirthdayEvaluator(prisma);
    const candidates = await evaluator.findCandidates('studio-1', { type: 'BIRTHDAY', daysBefore: 0 }, now);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].targetRef).toBe('member-1:2026');
  });

  it('excludes a member with a different birthday', async () => {
    const prisma = buildPrisma([
      {
        id: 'member-2',
        birthDate: new Date('1990-07-01T00:00:00.000Z'),
        membership: { userId: 'user-2', user: { firstName: 'Kaya' } },
      },
    ]);
    const evaluator = new BirthdayEvaluator(prisma);
    const candidates = await evaluator.findCandidates('studio-1', { type: 'BIRTHDAY', daysBefore: 0 }, now);
    expect(candidates).toHaveLength(0);
  });

  it('honours daysBefore, matching a birthday a few days out', async () => {
    const prisma = buildPrisma([
      {
        id: 'member-3',
        birthDate: new Date('1990-06-18T00:00:00.000Z'),
        membership: { userId: 'user-3', user: { firstName: 'Ada' } },
      },
    ]);
    const evaluator = new BirthdayEvaluator(prisma);
    const candidates = await evaluator.findCandidates('studio-1', { type: 'BIRTHDAY', daysBefore: 3 }, now);
    expect(candidates).toHaveLength(1);
  });
});
