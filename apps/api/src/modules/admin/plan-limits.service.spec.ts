import { HttpException, HttpStatus } from '@nestjs/common';
import { PlanLimitsService } from './plan-limits.service';

const STUDIO = 'studio-1';

function makePrisma(subscription: unknown) {
  return {
    subscription: { findFirst: jest.fn().mockResolvedValue(subscription) },
    membership: { count: jest.fn() },
    branch: { count: jest.fn() },
  };
}

describe('PlanLimitsService.assertWithinLimit', () => {
  it('does nothing when the studio has no active subscription', async () => {
    const prisma = makePrisma(null);
    const service = new PlanLimitsService(prisma as never);
    await expect(service.assertWithinLimit(STUDIO, 'maxActiveMembers')).resolves.toBeUndefined();
    expect(prisma.membership.count).not.toHaveBeenCalled();
  });

  it('does nothing when the plan sets no limit for that kind', async () => {
    const prisma = makePrisma({ plan: { limits: {} } });
    const service = new PlanLimitsService(prisma as never);
    await expect(service.assertWithinLimit(STUDIO, 'maxActiveMembers')).resolves.toBeUndefined();
  });

  it('allows creation below the limit', async () => {
    const prisma = makePrisma({ plan: { limits: { maxActiveMembers: 10 } } });
    prisma.membership.count.mockResolvedValue(9);
    const service = new PlanLimitsService(prisma as never);
    await expect(service.assertWithinLimit(STUDIO, 'maxActiveMembers')).resolves.toBeUndefined();
  });

  it('throws 402 Payment Required at the limit', async () => {
    const prisma = makePrisma({ plan: { limits: { maxActiveMembers: 10 } } });
    prisma.membership.count.mockResolvedValue(10);
    const service = new PlanLimitsService(prisma as never);
    await expect(service.assertWithinLimit(STUDIO, 'maxActiveMembers')).rejects.toMatchObject({
      status: HttpStatus.PAYMENT_REQUIRED,
    });
    await expect(service.assertWithinLimit(STUDIO, 'maxActiveMembers')).rejects.toBeInstanceOf(HttpException);
  });

  it('enforces the branch limit separately from members', async () => {
    const prisma = makePrisma({ plan: { limits: { maxBranches: 2 } } });
    prisma.branch.count.mockResolvedValue(2);
    const service = new PlanLimitsService(prisma as never);
    await expect(service.assertWithinLimit(STUDIO, 'maxBranches')).rejects.toBeInstanceOf(HttpException);
  });
});
