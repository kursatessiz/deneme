import { randomBytes, createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CalendarFeedCreatedDTO } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MeBookingsService } from './me-bookings.service';
import { buildIcsCalendar, type IcsEventInput } from './ics-builder';

const LOOKBACK_DAYS = 30;
const PRODUCT_ID = '-//platform//calendar-feed//TR';

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Per-user secret ICS feed. Only a sha256 hash of the token is ever
 * persisted; the raw value is returned once, on create/rotate, and never
 * logged.
 */
@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly meBookings: MeBookingsService,
  ) {}

  async hasFeed(userId: string): Promise<boolean> {
    const row = await this.prisma.calendarFeedToken.findUnique({ where: { userId }, select: { id: true } });
    return row != null;
  }

  /** Creates or replaces the caller's feed token; any previously issued URL stops working. */
  async rotate(userId: string): Promise<CalendarFeedCreatedDTO> {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const row = await this.prisma.calendarFeedToken.upsert({
      where: { userId },
      create: { userId, tokenHash },
      update: { tokenHash, lastUsedAt: null },
    });
    return { ...this.buildUrls(rawToken), createdAt: row.createdAt.toISOString() };
  }

  async revoke(userId: string): Promise<void> {
    await this.prisma.calendarFeedToken.deleteMany({ where: { userId } });
  }

  /** Resolves a raw token from the public feed URL to a user id, or null when unknown. */
  async resolveUserId(rawToken: string): Promise<string | null> {
    const tokenHash = hashToken(rawToken);
    const row = await this.prisma.calendarFeedToken.findUnique({ where: { tokenHash }, select: { id: true, userId: true } });
    if (!row) return null;
    // Best-effort; a failure here must never block serving the calendar.
    this.prisma.calendarFeedToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    return row.userId;
  }

  /** Builds the ICS document for a resolved user: upcoming bookings plus the last 30 days. */
  async buildIcsForUser(userId: string): Promise<string> {
    const memberProfileIds = await this.meBookings.memberProfileIdsFor(userId);
    if (memberProfileIds.length === 0) {
      return buildIcsCalendar({ calendarName: 'Rezervasyonlarim', productId: PRODUCT_ID, events: [] });
    }

    const since = new Date();
    since.setDate(since.getDate() - LOOKBACK_DAYS);

    const bookings = await this.prisma.booking.findMany({
      where: {
        memberId: { in: memberProfileIds },
        status: { in: ['CONFIRMED', 'ATTENDED', 'CANCELLED_EARLY', 'CANCELLED_LATE', 'NO_SHOW'] },
        schedule: { startTime: { gte: since } },
      },
      include: {
        studio: { select: { name: true } },
        schedule: {
          include: {
            serviceType: { select: { name: true } },
            branch: { select: { name: true } },
          },
        },
      },
      orderBy: { schedule: { startTime: 'asc' } },
    });

    const events: IcsEventInput[] = bookings.map((booking) => ({
      uid: `booking-${booking.id}@platform`,
      summary: `${booking.schedule.serviceType.name} - ${booking.studio.name}`,
      start: booking.schedule.startTime,
      end: booking.schedule.endTime,
      location: booking.schedule.branch?.name ?? booking.studio.name,
      status: booking.status === 'CONFIRMED' || booking.status === 'ATTENDED' ? 'CONFIRMED' : 'CANCELLED',
      createdAt: booking.createdAt,
    }));

    return buildIcsCalendar({ calendarName: 'Rezervasyonlarim', productId: PRODUCT_ID, events });
  }

  private buildUrls(rawToken: string): { url: string; webcalUrl: string } {
    const base = this.config.get<string>('PUBLIC_APP_URL', 'http://localhost:3000').replace(/\/$/, '');
    const path = `/calendar/${rawToken}.ics`;
    const httpUrl = `${base}${path}`;
    const webcalUrl = httpUrl.replace(/^https?:\/\//, 'webcal://');
    return { url: httpUrl, webcalUrl };
  }
}
