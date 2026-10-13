import { CampaignsService } from './campaigns.service';

describe('CampaignsService.processCampaign start ordering', () => {
  const now = new Date('2026-10-09T10:00:00Z');
  const campaign = {
    id: 'camp-1',
    studioId: 'studio-1',
    status: 'SCHEDULED',
    scheduledAt: new Date('2026-10-09T09:00:00Z'),
    segmentId: 'seg-1',
    abTest: null,
    channel: 'EMAIL',
  };

  const build = () => {
    const prisma = {
      campaign: {
        findUnique: jest.fn().mockResolvedValue(campaign),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
      campaignRecipient: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
    };
    const segments = { memberIds: jest.fn().mockResolvedValue(['c1', 'c2']) };
    const approvals = { isPlatformStudio: jest.fn().mockResolvedValue(false) };
    const sendTime = { context: jest.fn().mockResolvedValue(null) };
    const service = new CampaignsService(
      prisma as never,
      {} as never,
      segments as never,
      {} as never,
      approvals as never,
      {} as never,
      sendTime as never,
      {} as never,
    );
    return { service, prisma };
  };

  it('writes the audience before the campaign leaves SCHEDULED', async () => {
    const { service, prisma } = build();
    // Stop right after the start step: the campaign is not SENDING in the mocked re-read.
    await service.processCampaign('camp-1', now);
    const order = [
      prisma.campaignRecipient.createMany.mock.invocationCallOrder[0],
      ...prisma.campaign.updateMany.mock.invocationCallOrder,
    ];
    expect(prisma.campaignRecipient.createMany).toHaveBeenCalled();
    const statusFlip = prisma.campaign.updateMany.mock.calls.findIndex((c) => (c[0] as { data: { status?: string } }).data.status === 'SENDING');
    expect(statusFlip).toBeGreaterThanOrEqual(0);
    expect(order[0]).toBeLessThan(prisma.campaign.updateMany.mock.invocationCallOrder[statusFlip]);
  });

  it('a crash while writing the audience leaves the campaign SCHEDULED', async () => {
    const { service, prisma } = build();
    prisma.campaignRecipient.createMany.mockRejectedValueOnce(new Error('connection lost'));
    await expect(service.processCampaign('camp-1', now)).rejects.toThrow('connection lost');
    const flips = prisma.campaign.updateMany.mock.calls.filter((c) => (c[0] as { data: { status?: string } }).data.status === 'SENDING');
    expect(flips).toHaveLength(0);
  });
});
