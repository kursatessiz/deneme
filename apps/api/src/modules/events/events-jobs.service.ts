import { Injectable, Logger } from '@nestjs/common';
import { EVENT_REMINDER_HOURS, EVENT_TEMPLATE_KEYS } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { EventSeatsService } from './event-seats.service';

const HOUR_MS = 60 * 60 * 1000;
/** Rows handled per heartbeat and step; the rest follow on the next run. */
const BATCH = 200;

export interface EventsHeartbeatResult {
  holdsReleased: number;
  promoted: number;
  reminders: number;
  completed: number;
}

/**
 * Event work on the scheduler heartbeat (JobsService, every 15 minutes):
 * releases seats whose payment deadline passed (and offers them to the
 * waitlist), sends the reminder EVENT_REMINDER_HOURS before each
 * occurrence, and marks finished events COMPLETED. Each step is
 * idempotent: holds move with a conditional status update, a reminder is
 * sent once per occurrence and registration (reminderSentAt plus the
 * messaging idempotency key).
 */
@Injectable()
export class EventsJobsService {
  private readonly logger = new Logger(EventsJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly seats: EventSeatsService,
  ) {}

  async run(now: Date): Promise<EventsHeartbeatResult> {
    const holds = await this.releaseExpiredHolds(now);
    const reminders = await this.sendReminders(now);
    const completed = await this.completeFinished(now);
    return { holdsReleased: holds.released, promoted: holds.promoted, reminders, completed };
  }

  async releaseExpiredHolds(now: Date): Promise<{ released: number; promoted: number }> {
    const due = await this.prisma.eventRegistration.findMany({
      where: { status: 'PENDING_PAYMENT', paymentDueAt: { lte: now } },
      orderBy: { paymentDueAt: 'asc' },
      take: BATCH,
    });
    let released = 0;
    const events = new Map<string, string>();
    for (const reg of due) {
      try {
        const ok = await this.prisma.$transaction((tx) => this.seats.cancelTx(tx, reg, { reason: 'PAYMENT_EXPIRED', refundUnits: true, now }));
        if (ok) {
          released++;
          events.set(reg.eventId, reg.studioId);
        }
      } catch (err) {
        this.logger.warn(`Releasing event hold ${reg.id} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    let promoted = 0;
    for (const [eventId, studioId] of events) promoted += await this.seats.promoteWaitlistSafe(studioId, eventId);
    return { released, promoted };
  }

  async sendReminders(now: Date): Promise<number> {
    const until = new Date(now.getTime() + EVENT_REMINDER_HOURS * HOUR_MS);
    const occurrences = await this.prisma.eventOccurrence.findMany({
      where: { startsAt: { gt: now, lte: until }, reminderSentAt: null, event: { status: 'PUBLISHED' } },
      select: { id: true, studioId: true, eventId: true, startsAt: true },
      orderBy: { startsAt: 'asc' },
      take: BATCH,
    });
    let sent = 0;
    for (const occurrence of occurrences) {
      // Claimed first: a concurrent heartbeat skips it; the idempotency key covers a crash mid-way.
      const claimed = await this.prisma.eventOccurrence.updateMany({ where: { id: occurrence.id, reminderSentAt: null }, data: { reminderSentAt: now } });
      if (claimed.count === 0) continue;
      const registrations = await this.prisma.eventRegistration.findMany({
        where: { studioId: occurrence.studioId, eventId: occurrence.eventId, status: 'CONFIRMED' },
        select: { id: true },
      });
      for (const r of registrations) {
        if (await this.seats.notify(r.id, EVENT_TEMPLATE_KEYS.reminder, `event-reminder:${occurrence.id}:${r.id}`, occurrence.startsAt)) sent++;
      }
    }
    return sent;
  }

  async completeFinished(now: Date): Promise<number> {
    const result = await this.prisma.event.updateMany({
      where: { status: 'PUBLISHED', endsAt: { lt: now } },
      data: { status: 'COMPLETED', completedAt: now },
    });
    return result.count;
  }
}
