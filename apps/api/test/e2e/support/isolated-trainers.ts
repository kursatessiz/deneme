import { randomInt } from 'crypto';
import type { PrismaClient } from '@platform/database';

/**
 * Trainers created for one suite. Seeded trainers have seeded sessions at
 * daytime hours, so a suite that schedules them "N hours from now" can hit a
 * trainer conflict depending on when it runs. Trainers made here have no
 * other sessions, which keeps conflict checks deterministic.
 */
export interface IsolatedTrainer {
  userId: string;
  trainerProfileId: string;
}

export async function createIsolatedTrainers(
  prisma: PrismaClient,
  studioId: string,
  roleTemplateId: string,
  count: number,
): Promise<IsolatedTrainer[]> {
  const created: IsolatedTrainer[] = [];
  for (let i = 0; i < count; i++) {
    // +90 599 is outside the seeded ranges; the random tail avoids clashes between runs.
    const phone = `+90599${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
    const user = await prisma.user.create({
      data: { phone, firstName: 'E2E', lastName: `Egitmen ${i + 1}` },
    });
    const membership = await prisma.membership.create({
      data: { userId: user.id, studioId, roleTemplateId, status: 'ACTIVE', joinedAt: new Date() },
    });
    const profile = await prisma.trainerProfile.create({ data: { membershipId: membership.id, studioId } });
    created.push({ userId: user.id, trainerProfileId: profile.id });
  }
  return created;
}

/** Removes the users; memberships and trainer profiles cascade. Delete their schedules first. */
export async function removeIsolatedTrainers(prisma: PrismaClient, trainers: IsolatedTrainer[]): Promise<void> {
  await prisma.user.deleteMany({ where: { id: { in: trainers.map((t) => t.userId) } } });
}
