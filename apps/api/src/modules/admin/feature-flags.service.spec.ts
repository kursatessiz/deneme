import { FeatureFlagsService } from './feature-flags.service';

const STUDIO = 'studio-1';
const BUSINESS_TYPE = 'bt-1';

function makePrisma() {
  return {
    studio: { findUnique: jest.fn() },
    featureFlag: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(this)),
  };
}

describe('FeatureFlagsService.isFeatureEnabled precedence', () => {
  it('a tenant-scoped flag wins over business-type and global flags', async () => {
    const prisma = makePrisma();
    prisma.studio.findUnique.mockResolvedValue({ businessTypeTemplateId: BUSINESS_TYPE });
    prisma.featureFlag.findFirst
      .mockResolvedValueOnce({ enabled: true }) // TENANT
      .mockResolvedValueOnce({ enabled: false }) // BUSINESS_TYPE
      .mockResolvedValueOnce({ enabled: false }); // GLOBAL

    const service = new FeatureFlagsService(prisma as never);
    await expect(service.isFeatureEnabled(STUDIO, 'gamification')).resolves.toBe(true);
  });

  it('falls back to business-type when there is no tenant override', async () => {
    const prisma = makePrisma();
    prisma.studio.findUnique.mockResolvedValue({ businessTypeTemplateId: BUSINESS_TYPE });
    prisma.featureFlag.findFirst
      .mockResolvedValueOnce(null) // TENANT
      .mockResolvedValueOnce({ enabled: true }) // BUSINESS_TYPE
      .mockResolvedValueOnce({ enabled: false }); // GLOBAL

    const service = new FeatureFlagsService(prisma as never);
    await expect(service.isFeatureEnabled(STUDIO, 'gamification')).resolves.toBe(true);
  });

  it('falls back to global when neither tenant nor business-type flags exist', async () => {
    const prisma = makePrisma();
    prisma.studio.findUnique.mockResolvedValue({ businessTypeTemplateId: null });
    prisma.featureFlag.findFirst
      .mockResolvedValueOnce(null) // TENANT
      .mockResolvedValueOnce({ enabled: true }); // GLOBAL (no business-type lookup, template id is null)

    const service = new FeatureFlagsService(prisma as never);
    await expect(service.isFeatureEnabled(STUDIO, 'gamification')).resolves.toBe(true);
  });

  it('defaults to disabled when no flag exists at any scope', async () => {
    const prisma = makePrisma();
    prisma.studio.findUnique.mockResolvedValue({ businessTypeTemplateId: null });
    prisma.featureFlag.findFirst.mockResolvedValue(null);

    const service = new FeatureFlagsService(prisma as never);
    await expect(service.isFeatureEnabled(STUDIO, 'gamification')).resolves.toBe(false);
  });
});
