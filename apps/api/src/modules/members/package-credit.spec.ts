import { creditActivePackageUnits } from './package-credit';

describe('creditActivePackageUnits', () => {
  const NOW = new Date('2026-06-15T10:00:00.000Z');

  function fakeTx(pkg: { id: string; totalUnits: number | null; remainingUnits: number | null } | null) {
    return {
      memberPackage: {
        findFirst: jest.fn().mockResolvedValue(pkg),
        update: jest.fn().mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id })),
      },
    };
  }

  it('only considers ACTIVE packages that end after now', async () => {
    const tx = fakeTx({ id: 'pkg-1', totalUnits: 10, remainingUnits: 4 });
    await creditActivePackageUnits(tx as never, 'studio-1', 'member-1', 2, NOW);
    expect(tx.memberPackage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ studioId: 'studio-1', memberId: 'member-1', status: 'ACTIVE', endDate: { gt: NOW } }) }),
    );
  });

  it('returns null and credits nothing when only expired packages exist (lookup finds none)', async () => {
    const tx = fakeTx(null);
    await expect(creditActivePackageUnits(tx as never, 'studio-1', 'member-1', 2, NOW)).resolves.toBeNull();
    expect(tx.memberPackage.update).not.toHaveBeenCalled();
  });

  it('adds units with relative increments', async () => {
    const tx = fakeTx({ id: 'pkg-1', totalUnits: 10, remainingUnits: 4 });
    await creditActivePackageUnits(tx as never, 'studio-1', 'member-1', 3, NOW);
    expect(tx.memberPackage.update).toHaveBeenCalledWith({
      where: { id: 'pkg-1' },
      data: { totalUnits: { increment: 3 }, remainingUnits: { increment: 3 } },
    });
  });
});
