import { WinBackEvaluator } from './win-back.evaluator';
import { PrismaService } from '../../prisma/prisma.service';

describe('WinBackEvaluator', () => {
  const now = new Date('2026-02-01T10:00:00.000Z');

  function buildPrisma(members: unknown[]) {
    return {
      memberProfile: { findMany: jest.fn().mockResolvedValue(members) },
      studio: { findUniqueOrThrow: jest.fn().mockResolvedValue({ name: 'Zen Reformer' }) },
    } as unknown as PrismaService;
  }

  it('includes a member with no active package and no attendance in the window', async () => {
    const prisma = buildPrisma([
      {
        id: 'member-1',
        membership: { userId: 'user-1', user: { firstName: 'Ayse' } },
        bookings: [{ schedule: { startTime: new Date('2025-11-01T10:00:00.000Z') } }],
        packages: [],
      },
    ]);
    const evaluator = new WinBackEvaluator(prisma);
    const candidates = await evaluator.findCandidates('studio-1', { type: 'WIN_BACK', noAttendanceDays: 30, requireNoActivePackage: true }, now);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ userId: 'user-1', templateParams: { firstName: 'Ayse', studioName: 'Zen Reformer' } });
  });

  it('excludes a member who attended recently', async () => {
    const prisma = buildPrisma([
      {
        id: 'member-2',
        membership: { userId: 'user-2', user: { firstName: 'Mert' } },
        bookings: [{ schedule: { startTime: new Date('2026-01-25T10:00:00.000Z') } }],
        packages: [],
      },
    ]);
    const evaluator = new WinBackEvaluator(prisma);
    const candidates = await evaluator.findCandidates('studio-1', { type: 'WIN_BACK', noAttendanceDays: 30, requireNoActivePackage: true }, now);
    expect(candidates).toHaveLength(0);
  });

  it('excludes a member with an active package when requireNoActivePackage is true', async () => {
    const prisma = buildPrisma([
      {
        id: 'member-3',
        membership: { userId: 'user-3', user: { firstName: 'Can' } },
        bookings: [],
        packages: [{ id: 'pkg-1' }],
      },
    ]);
    const evaluator = new WinBackEvaluator(prisma);
    const candidates = await evaluator.findCandidates('studio-1', { type: 'WIN_BACK', noAttendanceDays: 30, requireNoActivePackage: true }, now);
    expect(candidates).toHaveLength(0);
  });

  it('includes a member who never attended', async () => {
    const prisma = buildPrisma([
      { id: 'member-4', membership: { userId: 'user-4', user: { firstName: 'Ela' } }, bookings: [], packages: [] },
    ]);
    const evaluator = new WinBackEvaluator(prisma);
    const candidates = await evaluator.findCandidates('studio-1', { type: 'WIN_BACK', noAttendanceDays: 30, requireNoActivePackage: true }, now);
    expect(candidates).toHaveLength(1);
  });
});
