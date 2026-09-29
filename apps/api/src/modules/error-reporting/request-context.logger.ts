import { ConsoleLogger } from '@nestjs/common';
import { currentRequestId } from './request-context';

/**
 * The Nest console logger with the request's correlation id after the
 * context, e.g. `[BookingsService] [rid:0b1c...]`. Installed in main.ts,
 * so every existing Logger call carries the id without code changes.
 */
export class RequestContextLogger extends ConsoleLogger {
  protected formatContext(context: string): string {
    const base = super.formatContext(context);
    const requestId = currentRequestId();
    return requestId ? `${base}[rid:${requestId}] ` : base;
  }
}
