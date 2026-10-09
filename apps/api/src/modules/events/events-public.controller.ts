import { CanActivate, Controller, ExecutionContext, Get, HttpException, HttpStatus, Injectable, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { PublicEventRegisterSchema } from '@platform/shared';
import type { PublicEventRegisterInput } from '@platform/shared';
import { ZodBody } from '../../common/zod-body.pipe';
import { RedisService } from '../redis/redis.service';
import { incrementWithTtl } from '../redis/increment-with-ttl';
import { readVisitorId } from '../crm/tracking/tracking-utils';
import { EventRegistrationsService } from './event-registrations.service';
import { apiError } from '../../common/api-error';
import { isInternalServerRequest } from '../../common/internal-request';

const WINDOW_SECONDS = 60;
/** Reads are cheap listings; writes create contacts and hold seats. */
const MAX_READS = 60;
const MAX_WRITES = 5;

/**
 * Fixed-window IP limiter for the public event endpoints, same pattern as
 * LeadsPublicRateLimitGuard: Redis when configured, an in-memory fallback
 * otherwise (single instance only), never failing open. Reads and writes
 * have separate budgets.
 */
@Injectable()
export class EventsPublicRateLimitGuard implements CanActivate {
  private readonly memoryCounters = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    // Server renders of the web container (no X-Forwarded-For, private peer) are not one visitor; never count them.
    if (isInternalServerRequest(req)) return true;
    const write = req.method !== 'GET' && req.method !== 'HEAD';
    const limit = write ? MAX_WRITES : MAX_READS;
    const key = `events-public-rl:${write ? 'w' : 'r'}:${req.ip ?? 'unknown'}`;

    const client = this.redis.getClient();
    if (client) {
      try {
        if (client.status === 'wait') await client.connect();
        const count = await incrementWithTtl(client, key, WINDOW_SECONDS);
        if (count > limit) throw new HttpException(apiError('apiErrors.common.tooManyRequests'), HttpStatus.TOO_MANY_REQUESTS);
        return true;
      } catch (err) {
        if (err instanceof HttpException) throw err;
        // Redis unreachable mid-request: fall through to the in-memory bucket.
      }
    }

    const now = Date.now();
    const entry = this.memoryCounters.get(key);
    if (!entry || entry.resetAt <= now) {
      this.memoryCounters.set(key, { count: 1, resetAt: now + WINDOW_SECONDS * 1000 });
      return true;
    }
    entry.count += 1;
    if (entry.count > limit) throw new HttpException(apiError('apiErrors.common.tooManyRequests'), HttpStatus.TOO_MANY_REQUESTS);
    return true;
  }
}

/**
 * Unauthenticated event listing, detail and guest registration by studio
 * slug (docs/ETKINLIKLER.md). Only PUBLIC and PUBLISHED events are ever
 * returned; nothing about other registrants is exposed.
 */
@Controller('public/studios/:slug/events')
@UseGuards(EventsPublicRateLimitGuard)
export class EventsPublicController {
  constructor(private readonly registrations: EventRegistrationsService) {}

  @Get()
  async list(@Param('slug') slug: string) {
    return { items: await this.registrations.publicList(slug) };
  }

  @Get(':eventId')
  get(@Param('slug') slug: string, @Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.registrations.publicGet(slug, eventId);
  }

  @Post(':eventId/registrations')
  register(
    @Param('slug') slug: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @ZodBody(PublicEventRegisterSchema) body: PublicEventRegisterInput,
    @Req() req: Request,
  ) {
    return this.registrations.publicRegister(slug, eventId, body, readVisitorId(req.headers));
  }
}
