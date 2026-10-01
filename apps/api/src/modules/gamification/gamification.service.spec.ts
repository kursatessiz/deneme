import { BadgeKind } from '@platform/shared';
import { GamificationService } from './gamification.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';

/**
 * The studio setting is read when an evaluation starts and again right before
 * every award, so turning gamification off while an evaluation is in flight
 * stops any further badge from being created.
 */
describe('GamificationService award-time setting check', () => {
  const definitions = [
    { id: 'd1', name: 'First', description: null, kind: BadgeKind.FIRST_SESSION, threshold: { kind: BadgeKind.FIRST_SESSION } },
    { id: 'd2', name: 'Ten', description: null, kind: BadgeKind.MILESTONE_SESSIONS, threshold: { kind: BadgeKind.MILESTONE_SESSIONS, sessions: 1 } },
  ];

  function build(enabledReads: boolean[]) {
    const create = jest.fn().mockResolvedValue({ id: 'b1' });
    const findUnique = jest.fn(async (args: { select: Record<string, boolean> }) => {
      if ('timezone' in args.select) return { timezone: 'UTC', gamificationEnabled: true };
      return { gamificationEnabled: enabledReads.shift() ?? false };
    });
    const prisma = {
      studio: { findUnique },
      booking: { findMany: jest.fn().mockResolvedValue([{ schedule: { startTime: new Date(), serviceTypeId: 's1' } }]) },
      memberGoal: { findMany: jest.fn().mockResolvedValue([]) },
      badgeDefinition: { findMany: jest.fn().mockResolvedValue(definitions) },
      memberBadge: { findMany: jest.fn().mockResolvedValue([]), create },
      memberProfile: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new GamificationService(prisma, {} as NotificationsService);
    return { service, create };
  }

  it('awards every met badge while the setting stays on', async () => {
    const { service, create } = build([true, true]);
    const awarded = await (service as unknown as { evaluateMemberBadges(s: string, m: string): Promise<unknown[]> }).evaluateMemberBadges('st', 'm');
    expect(awarded).toHaveLength(2);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('stops awarding when the setting is turned off mid-evaluation', async () => {
    const { service, create } = build([true, false]);
    const awarded = await (service as unknown as { evaluateMemberBadges(s: string, m: string): Promise<unknown[]> }).evaluateMemberBadges('st', 'm');
    expect(awarded).toHaveLength(1);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
