import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@platform/database';
import { SCANNED_JOURNEY_TRIGGERS } from '@platform/shared';
import { AppModule } from '../../src/app.module';
import { JourneyScannersService } from '../../src/modules/growth/journeys/journey-scanners.service';

/**
 * Journey scanners must not spend their per-heartbeat window on candidates the
 * journey already enrolled, and must serve the newest candidates first.
 * Builds its own journey, schedules and bookings on an existing seed member
 * and removes them afterwards.
 */
describe('Journey scanners skip already enrolled candidates (e2e)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaClient;
  let ZEN: string;
  let journeyId: string;
  let memberId: string;
  const scheduleIds: string[] = [];
  const bookingIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await moduleRef.init();
    prisma = new PrismaClient();
    ZEN = (await prisma.studio.findUniqueOrThrow({ where: { slug: 'zen-reformer-pilates' } })).id;
    const serviceTypeId = (await prisma.serviceType.findFirstOrThrow({ where: { studioId: ZEN } })).id;
    const member = await prisma.memberProfile.findFirstOrThrow({
      where: { studioId: ZEN, membership: { status: 'ACTIVE', isPartnerGuest: false } },
    });
    memberId = member.id;
    const journey = await prisma.journey.create({
      data: { studioId: ZEN, name: 'E2E scan dedupe', status: 'ACTIVE', definition: {} },
    });
    journeyId = journey.id;
    for (const hoursAgo of [5, 3]) {
      const start = new Date(Date.now() - hoursAgo * 3600_000);
      const schedule = await prisma.sessionSchedule.create({
        data: { studioId: ZEN, serviceTypeId, title: 'E2E scan session', startTime: start, endTime: new Date(start.getTime() + 3600_000), capacity: 5 },
      });
      scheduleIds.push(schedule.id);
      const booking = await prisma.booking.create({
        data: { studioId: ZEN, scheduleId: schedule.id, memberId, status: 'ATTENDED', checkInAt: new Date(start.getTime() + 600_000) },
      });
      bookingIds.push(booking.id);
    }
  });

  afterAll(async () => {
    await prisma.journeyEnrollment.deleteMany({ where: { journeyId } });
    await prisma.journey.delete({ where: { id: journeyId } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.sessionSchedule.deleteMany({ where: { id: { in: scheduleIds } } });
    await prisma.$disconnect();
    await moduleRef.close();
  });

  it('returns the newest attended booking first and omits one that is already enrolled', async () => {
    const scanners = moduleRef.get(JourneyScannersService);
    const trigger = { kind: 'event', event: 'session_attended' } as const;
    const now = new Date();
    const floor = new Date(now.getTime() - 24 * 3600_000);

    const before = (await scanners.scan(ZEN, trigger, now, floor, journeyId)).filter((c) => bookingIds.includes(c.ref));
    expect(before.map((c) => c.ref)).toEqual([bookingIds[1], bookingIds[0]]);

    await prisma.journeyEnrollment.create({
      data: {
        studioId: ZEN,
        journeyId,
        contactId: before[0].contactId,
        triggerRef: bookingIds[1],
        stepEnteredAt: now,
      },
    });
    const after = (await scanners.scan(ZEN, trigger, now, floor, journeyId)).filter((c) => bookingIds.includes(c.ref));
    expect(after.map((c) => c.ref)).toEqual([bookingIds[0]]);
  });

  it('runs every scanned trigger with the enrollment exclusion without a query error', async () => {
    const scanners = moduleRef.get(JourneyScannersService);
    const now = new Date();
    const floor = new Date(now.getTime() - 7 * 24 * 3600_000);
    for (const event of SCANNED_JOURNEY_TRIGGERS) {
      const trigger = { kind: 'event', event, daysBefore: 3, leadMinutes: 60 } as const;
      await expect(scanners.scan(ZEN, trigger as never, now, floor, journeyId)).resolves.toBeInstanceOf(Array);
    }
  });
});
