import { PrismaClient, ensurePlatformDefaults } from '@platform/database';
import { runBootstrap } from '../../src/cli/bootstrap';

/**
 * D1: the production bootstrap command against the real (seeded) test
 * database. The seed builds its platform catalogue from the same defaults
 * module, so on a seeded database every default is already present: a run
 * must create nothing and change no table, however often it is repeated.
 * (The fresh, empty database case is exercised by hand in the D1 PR and in
 * docs/CICD_GUIDE.md "Preprod ortamı".)
 */

async function tableCounts(prisma: PrismaClient): Promise<Record<string, number>> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename`;
  const counts: Record<string, number> = {};
  for (const { tablename } of tables) {
    const [row] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${tablename.replace(/"/g, '""')}"`);
    counts[tablename] = Number(row.n);
  }
  return counts;
}

describe('Platform bootstrap (e2e)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('finds every platform default already present after the seed and changes nothing, twice', async () => {
    const before = await tableCounts(prisma);

    for (let run = 0; run < 2; run++) {
      const result = await prisma.$transaction((tx) => ensurePlatformDefaults(tx), { timeout: 60_000 });
      expect(result.created).toEqual({});
      expect(Object.keys(result.planIds).sort()).toEqual(['pro', 'starter']);
      expect(result.platformStudioId).toBe((await prisma.studio.findFirstOrThrow({ where: { isPlatform: true } })).id);
    }

    expect(await tableCounts(prisma)).toEqual(before);
  });

  it('--defaults-only through the CLI entry point creates no user and prints that nothing was created', async () => {
    const usersBefore = await prisma.user.count();
    const lines: string[] = [];
    const res = await runBootstrap({ help: false, allowAdditionalSuperAdmin: false, superAdmin: null }, { prisma }, { out: (l) => lines.push(l) });
    expect(res.superAdmin).toBeNull();
    expect(lines).toEqual(['Platform defaults: already present, nothing created.']);
    expect(await prisma.user.count()).toBe(usersBefore);
  });
});
