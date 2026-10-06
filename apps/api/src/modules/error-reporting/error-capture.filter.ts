import { ArgumentsHost, Catch, HttpException, Injectable } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Request, Response } from 'express';
import { ERROR_CODE_HEADER, errorCodeFromId, normalizeRoute } from '@platform/shared';
import type { AuthenticatedRequest } from '../auth/tenant-context';
import { ErrorCaptureService } from './error-capture.service';

type CapturedRequest = Request & Pick<AuthenticatedRequest, 'user' | 'tenant'>;

/** Route pattern of the matched handler ("/studios/:studioId/members"), or the normalised path. */
export function routeOf(req: Request): string {
  const pattern = (req.route as { path?: unknown } | undefined)?.path;
  const path = typeof pattern === 'string' ? pattern : normalizeRoute(req.path ?? '');
  return `${req.method} ${path}`;
}

/**
 * An error body with a stable `code` (apiError, codedError, ...) but no
 * `statusCode` gets one, so every coded error has the same shape as a plain
 * Nest exception: `{ statusCode, code, message, params? }`.
 */
export function withStatusCode(exception: unknown): unknown {
  if (!(exception instanceof HttpException)) return exception;
  const body = exception.getResponse();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return exception;
  const record = body as Record<string, unknown>;
  if (typeof record.code !== 'string' || 'statusCode' in record) return exception;
  return new HttpException({ statusCode: exception.getStatus(), ...record }, exception.getStatus());
}

/**
 * Global filter that records unexpected server errors and then defers to
 * Nest's default handling, so every response keeps its existing shape.
 * Only 5xx are recorded: HttpExceptions with a 4xx status are expected
 * outcomes (validation, permissions, not found). A recorded 5xx gets the
 * short error code in the `x-error-code` response header. Provider
 * webhooks (payments, SMS, email) have no catch of their own, so their
 * unexpected failures are recorded here as well.
 */
@Catch()
@Injectable()
export class ErrorCaptureFilter extends BaseExceptionFilter {
  constructor(private readonly capture: ErrorCaptureService) {
    super();
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() === 'http') {
      try {
        const status = exception instanceof HttpException ? exception.getStatus() : 500;
        if (status >= 500) {
          const http = host.switchToHttp();
          const req = http.getRequest<CapturedRequest>();
          const res = http.getResponse<Response>();
          const eventId = this.capture.capture({
            source: 'api',
            severity: 'error',
            error: exception,
            route: routeOf(req),
            studioId: req.tenant?.studioId ?? null,
            userId: req.user?.id ?? null,
            statusCode: status,
          });
          if (eventId && !res.headersSent) res.setHeader(ERROR_CODE_HEADER, errorCodeFromId(eventId));
        }
      } catch {
        // Capturing must never change how the error is answered.
      }
    }
    super.catch(withStatusCode(exception), host);
  }
}
