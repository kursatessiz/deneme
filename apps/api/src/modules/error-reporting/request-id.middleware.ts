import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { REQUEST_ID_HEADER } from '@platform/shared';
import { resolveRequestId, runWithRequestContext } from './request-context';

/**
 * Correlation id for every request: the caller's `x-request-id` when it is
 * well formed (the web BFF always sends one), otherwise a new UUID. Echoed
 * in the response and available to logs and error capture for the rest of
 * the request through AsyncLocalStorage.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
    req.headers[REQUEST_ID_HEADER] = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    runWithRequestContext({ requestId }, () => next());
  }
}
