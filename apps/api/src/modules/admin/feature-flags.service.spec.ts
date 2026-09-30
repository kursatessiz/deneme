import { FeatureFlagsService } from './feature-flags.service';

const STUDIO = 'studio-1';
const BUSINESS_TYPE = 'bt-1';

function makePrisma() {
  return {
    studio: { findUnique: jest.fn() },
    featureFlag: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    studioAddOn: { findMany: jest.fn().mockResolvedValue([]) },
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

describe('FeatureFlagsService.isFeatureEnabled add-on layering', () => {
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000);

  function setup(flags: { tenant?: boolean; businessType?: boolean; global?: boolean }, addOns: { status: string; trialEndsAt: Date | null; currentPeriodEnd: Date | null }[]) {
    const prisma = makePrisma();
    prisma.studio.findUnique.mockResolvedValue({ businessTypeTemplateId: BUSINESS_TYPE });
    prisma.featureFlag.findFirst
      .mockResolvedValueOnce(flags.tenant === undefined ? null : { enabled: flags.tenant })
      .mockResolvedValueOnce(flags.businessType === undefined ? null : { enabled: flags.businessType })
      .mockResolvedValueOnce(flags.global === undefined ? null : { enabled: flags.global });
    prisma.studioAddOn.findMany.mockResolvedValue(addOns);
    return new FeatureFlagsService(prisma as never);
  }

  it('an ACTIVE add-on enables a flag that no scope enables', async () => {
    const service = setup({ global: false }, [{ status: 'ACTIVE', trialEndsAt: null, currentPeriodEnd: future }]);
    await expect(service.isFeatureEnabled(STUDIO, 'video_content')).resolves.toBe(true);
  });

  it('a TRIALING add-on enables it until the trial end, an expired trial does not', async () => {
    await expect(setup({}, [{ status: 'TRIALING', trialEndsAt: future, currentPeriodEnd: null }]).isFeatureEnabled(STUDIO, 'video_content')).resolves.toBe(true);
    await expect(setup({}, [{ status: 'TRIALING', trialEndsAt: past, currentPeriodEnd: null }]).isFeatureEnabled(STUDIO, 'video_content')).resolves.toBe(false);
  });

  it('a CANCELLED add-on keeps the flag on until its period end', async () => {
    await expect(setup({}, [{ status: 'CANCELLED', trialEndsAt: null, currentPeriodEnd: future }]).isFeatureEnabled(STUDIO, 'video_content')).resolves.toBe(true);
    await expect(setup({}, [{ status: 'CANCELLED', trialEndsAt: null, currentPeriodEnd: past }]).isFeatureEnabled(STUDIO, 'video_content')).resolves.toBe(false);
  });

  it('an explicit tenant override still wins over the add-on', async () => {
    const service = setup({ tenant: false }, [{ status: 'ACTIVE', trialEndsAt: null, currentPeriodEnd: future }]);
    await expect(service.isFeatureEnabled(STUDIO, 'video_content')).resolves.toBe(false);
  });
});
