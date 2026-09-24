import { Prisma, AutomationRunStatus } from '@platform/database';
import type { AutomationRule } from '@platform/database';
import { AutomationRunnerService } from './automation-runner.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

function buildRule(overrides: Partial<AutomationRule> = {}): AutomationRule {
  return {
    id: 'rule-1',
    studioId: 'studio-1',
    type: 'BOOKING_REMINDER',
    name: 'Seans hatırlatması',
    params: { type: 'BOOKING_REMINDER', hoursBefore: 2 },
    templateKey: 'BOOKING_REMINDER',
    channel: null,
    isTransactional: true,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AutomationRule;
}

function buildUniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: 'test' });
}

describe('AutomationRunnerService', () => {
  const now = new Date('2026-02-01T10:00:00.000Z'); // 13:00 Istanbul, outside quiet hours

  const mockEvaluator = { type: 'BOOKING_REMINDER', findCandidates: jest.fn() };
  const mockNotifications = { send: jest.fn() } as unknown as NotificationsService;

  function buildService(prismaOverrides: Record<string, unknown> = {}) {
    const prisma = {
      studio: { findUniqueOrThrow: jest.fn().mockResolvedValue({ timezone: 'Europe/Istanbul' }) },
      automationRun: { create: jest.fn(), update: jest.fn() },
      automationRule: { findMany: jest.fn() },
      ...prismaOverrides,
    } as unknown as PrismaService;

    const service = new AutomationRunnerService(
      prisma,
      mockNotifications,
      mockEvaluator as never,
      mockEvaluator as never,
      mockEvaluator as never,
      mockEvaluator as never,
      mockEvaluator as never,
      mockEvaluator as never,
    );
    return { service, prisma };
  }

  beforeEach(() => jest.clearAllMocks());

  it('skips a rule entirely during quiet hours (deferred to 09:00)', async () => {
    const { service, prisma } = buildService();
    (prisma.studio.findUniqueOrThrow as jest.Mock).mockResolvedValue({ timezone: 'Europe/Istanbul' });
    const quietNow = new Date('2026-02-01T19:00:00.000Z'); // 22:00 Istanbul
    const outcome = await service.runRule(buildRule(), quietNow);
    expect(outcome.deferredForQuietHours).toBe(true);
    expect(mockEvaluator.findCandidates).not.toHaveBeenCalled();
  });

  it('sends once per candidate and records SENT', async () => {
    mockEvaluator.findCandidates.mockResolvedValue([
      { userId: 'user-1', targetRef: 'booking-1', scheduledFor: now, templateParams: { firstName: 'Ayse' } },
    ]);
    (mockNotifications.send as jest.Mock).mockResolvedValue({ success: true, channel: 'SMS' });
    const { service, prisma } = buildService();

    const outcome = await service.runRule(buildRule(), now);

    expect(prisma.automationRun.create).toHaveBeenCalledTimes(1);
    expect(mockNotifications.send).toHaveBeenCalledTimes(1);
    expect(prisma.automationRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: AutomationRunStatus.SENT }) }),
    );
    expect(outcome).toMatchObject({ sent: 1, skipped: 0, failed: 0 });
  });

  it('does not send twice for the same target: a unique-constraint conflict short-circuits before send()', async () => {
    mockEvaluator.findCandidates.mockResolvedValue([
      { userId: 'user-1', targetRef: 'booking-1', scheduledFor: now, templateParams: { firstName: 'Ayse' } },
    ]);
    const { service, prisma } = buildService();
    (prisma.automationRun.create as jest.Mock).mockRejectedValue(buildUniqueViolation());

    const outcome = await service.runRule(buildRule(), now);

    expect(mockNotifications.send).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ sent: 0, skipped: 0, failed: 0 });
  });

  it('records SKIPPED for a policy reason (no consent) and FAILED for a delivery error', async () => {
    mockEvaluator.findCandidates.mockResolvedValue([
      { userId: 'user-1', targetRef: 'a', scheduledFor: now, templateParams: {} },
      { userId: 'user-2', targetRef: 'b', scheduledFor: now, templateParams: {} },
    ]);
    (mockNotifications.send as jest.Mock)
      .mockResolvedValueOnce({ success: false, reason: 'SMS için ticari mesaj onayı yok' })
      .mockResolvedValueOnce({ success: false, reason: 'Sağlayıcı zaman aşımı' });
    const { service } = buildService();

    const outcome = await service.runRule(buildRule({ type: 'WIN_BACK' }), now);
    expect(outcome).toMatchObject({ sent: 0, skipped: 1, failed: 1 });
  });
});
