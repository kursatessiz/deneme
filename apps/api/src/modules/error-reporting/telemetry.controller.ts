import { BadRequestException, Body, Controller, HttpCode, HttpException, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { ERROR_LIMITS, ErrorBatchSchema, ErrorFeedbackSchema, normalizeRoute, sampleEvent, scrubFeedback } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ErrorCaptureService } from './error-capture.service';
import { ErrorFeedbackService } from './error-feedback.service';
import { TELEMETRY_MAX_PER_IP, TELEMETRY_MAX_PER_SESSION, TelemetryRateLimiter } from './telemetry-rate-limit.service';
import { apiError } from '../../common/api-error';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 24 * 60 * 60 * 1000;

interface Caller {
  userId: string | null;
  studioId: string | null;
}

/**
 * Client error ingest (web now, mobile in H2): POST /telemetry/errors with
 * a batch of events. Public on purpose -- error screens on public pages
 * report too -- so every call is size limited, rate limited per IP and per
 * session, sampled and scrubbed again. An access token is optional; when
 * valid, the user and (after a membership check) the x-studio-id studio
 * are attached. Any studioId or user hash in the body is ignored.
 */
@Controller('telemetry')
export class TelemetryController {
  constructor(
    private readonly capture: ErrorCaptureService,
    private readonly limiter: TelemetryRateLimiter,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly feedbackService: ErrorFeedbackService,
  ) {}

  @Post('errors')
  @HttpCode(202)
  async ingest(@Req() req: Request, @Body() body: unknown): Promise<{ accepted: number }> {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (Number.isFinite(declared) && declared > ERROR_LIMITS.batchBytes) {
      throw new HttpException(apiError('apiErrors.errorReporting.requestBodyTooLarge'), HttpStatus.PAYLOAD_TOO_LARGE);
    }

    const caller = await this.resolveCaller(req);
    const firstSessionId = this.sessionIdOf(body);
    const sessionKey = caller.userId ? `u:${caller.userId}` : firstSessionId ? `s:${firstSessionId}` : null;
    const ipOk = await this.limiter.consume('ip', req.ip ?? 'unknown', TELEMETRY_MAX_PER_IP);
    const sessionOk = sessionKey ? await this.limiter.consume('session', sessionKey, TELEMETRY_MAX_PER_SESSION) : true;
    if (!ipOk || !sessionOk) throw new HttpException(apiError('apiErrors.common.tooManyRequests'), HttpStatus.TOO_MANY_REQUESTS);

    const parsed = ErrorBatchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ ...apiError('apiErrors.common.invalidRequest'), errors: parsed.error.issues.slice(0, 5).map((i) => i.path.join('.')) });

    const rate = this.config.get<number>('ERROR_CLIENT_SAMPLE_RATE') ?? 1;
    const now = Date.now();
    let accepted = 0;
    for (const event of parsed.data.events) {
      if (!sampleEvent(rate)) continue;
      const ts = Date.parse(event.timestamp);
      // Client clocks drift: an implausible timestamp becomes "now".
      const occurredAt = Number.isFinite(ts) && ts <= now + 5 * 60_000 && ts >= now - DAY_MS ? new Date(ts) : new Date(now);
      const id = this.capture.capture({
        source: event.source,
        severity: event.severity,
        type: event.type,
        message: event.message,
        stack: event.stack ?? null,
        route: event.route ? normalizeRoute(event.route) : null,
        requestId: event.requestId,
        studioId: caller.studioId,
        userId: caller.userId,
        breadcrumbs: event.breadcrumbs,
        eventId: event.eventId,
        release: event.release,
        environment: event.environment,
        occurredAt,
      });
      if (id) accepted++;
    }
    return { accepted };
  }

  /**
   * H3: the optional "what were you doing" note of an error screen. Same
   * anonymous/authenticated rules and rate limits as the batch endpoint; the
   * text is scrubbed again here and there is no field for an e-mail address.
   */
  @Post('errors/:eventId/feedback')
  @HttpCode(202)
  async feedback(@Req() req: Request, @Param('eventId') eventId: string, @Body() body: unknown): Promise<{ accepted: true }> {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (Number.isFinite(declared) && declared > ERROR_LIMITS.batchBytes) {
      throw new HttpException(apiError('apiErrors.errorReporting.requestBodyTooLarge'), HttpStatus.PAYLOAD_TOO_LARGE);
    }
    const caller = await this.resolveCaller(req);
    const bodySession = (body as { sessionId?: unknown } | null)?.sessionId;
    const sessionId = typeof bodySession === 'string' && bodySession.length <= 64 ? bodySession : null;
    const sessionKey = caller.userId ? `u:${caller.userId}` : sessionId ? `s:${sessionId}` : null;
    const ipOk = await this.limiter.consume('ip', req.ip ?? 'unknown', TELEMETRY_MAX_PER_IP);
    const sessionOk = sessionKey ? await this.limiter.consume('session', sessionKey, TELEMETRY_MAX_PER_SESSION) : true;
    if (!ipOk || !sessionOk) throw new HttpException(apiError('apiErrors.common.tooManyRequests'), HttpStatus.TOO_MANY_REQUESTS);

    if (!UUID.test(eventId)) throw new BadRequestException(apiError('apiErrors.common.invalidRequest'));
    const parsed = ErrorFeedbackSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(apiError('apiErrors.common.invalidRequest'));
    const text = scrubFeedback(parsed.data.feedback);
    if (!text) throw new BadRequestException(apiError('apiErrors.common.invalidRequest'));
    await this.feedbackService.attach(eventId.toLowerCase(), caller.userId, text);
    return { accepted: true };
  }

  private sessionIdOf(body: unknown): string | null {
    const events = (body as { events?: unknown } | null)?.events;
    const first = Array.isArray(events) ? (events[0] as { sessionId?: unknown } | undefined) : undefined;
    return typeof first?.sessionId === 'string' && first.sessionId.length <= 64 ? first.sessionId : null;
  }

  /** The authenticated user and studio, or anonymous. Never trusts a studio the user is not an active member of. */
  private async resolveCaller(req: Request): Promise<Caller> {
    const anonymous: Caller = { userId: null, studioId: null };
    const header = req.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return anonymous;
    let sub: string;
    try {
      const payload = await this.jwt.verifyAsync<{ sub?: string; typ?: string }>(header.slice(7), { algorithms: ['HS256'] });
      if (payload.typ !== 'access' || typeof payload.sub !== 'string') return anonymous;
      sub = payload.sub;
    } catch {
      return anonymous;
    }
    const user = await this.prisma.user.findUnique({ where: { id: sub }, select: { id: true, isActive: true, isSuperAdmin: true } });
    if (!user || !user.isActive) return anonymous;

    const rawStudio = req.headers['x-studio-id'];
    const studioId = Array.isArray(rawStudio) ? rawStudio[0] : rawStudio;
    if (typeof studioId !== 'string' || !UUID.test(studioId)) return { userId: user.id, studioId: null };
    if (user.isSuperAdmin) {
      const studio = await this.prisma.studio.findUnique({ where: { id: studioId }, select: { id: true } });
      return { userId: user.id, studioId: studio ? studio.id : null };
    }
    const membership = await this.prisma.membership.findUnique({
      where: { userId_studioId: { userId: user.id, studioId } },
      select: { status: true },
    });
    return { userId: user.id, studioId: membership?.status === 'ACTIVE' ? studioId : null };
  }
}
