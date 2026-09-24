import { PackageExpiringEvaluator } from './package-expiring.evaluator';
import { PrismaService } from '../../prisma/prisma.service';

describe('PackageExpiringEvaluator', () => {
  const now = new Date('2026-02-01T10:00:00.000Z');

  function buildPrisma(packages: unknown[]) {
    return {
      studio: { findUniqueOrThrow: jest.fn().mockResolvedValue({ timezone: 'Europe/Istanbul' }) },
      memberPackage: { findMany: jest.fn().mockResolvedValue(packages) },
    } as unknown as PrismaService;
  }

  const samplePackage = {
    id: 'pkg-1',
    endDate: new Date('2026-02-05T10:00:00.000Z'),
    remainingUnits: 2,
    packageDefinition: { name: '10 Ders Paketi' },
    member: { membership: { userId: 'user-1', user: { firstName: 'Deniz' } } },
  };

  it('maps a matching package to a candidate with the right template params', async () => {
    const prisma = buildPrisma([samplePackage]);
    const evaluator = new PackageExpiringEvaluator(prisma);
    const candidates = await evaluator.findCandidates('studio-1', { type: 'PACKAGE_EXPIRING', daysBefore: 7 }, now);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      userId: 'user-1',
      targetRef: 'pkg-1',
      templateParams: { firstName: 'Deniz', packageName: '10 Ders Paketi', remainingUnits: '2' },
    });
  });

  it('returns nothing when neither threshold is configured', async () => {
    const prisma = buildPrisma([samplePackage]);
    const evaluator = new PackageExpiringEvaluator(prisma);
    const candidates = await evaluator.findCandidates('studio-1', { type: 'PACKAGE_EXPIRING' }, now);
    expect(candidates).toHaveLength(0);
    expect((prisma.memberPackage.findMany as jest.Mock).mock.calls.length).toBe(0);
  });
});
