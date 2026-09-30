import { ConsoleLogger } from '@nestjs/common';
import { ERROR_LIMITS, scrubPii, truncate } from '@platform/shared';
import { currentRequestId } from './request-context';

/** The context Nest's default exception filter logs unhandled exceptions under. */
export const EXCEPTIONS_HANDLER_CONTEXT = 'ExceptionsHandler';

/**
 * A value logged by Nest's ExceptionsHandler (the message, the stack, or the
 * thrown non-Error value) as it may be written: personal data and secrets
 * masked with the same scrubber as stored events, cut to the stored lengths.
 * Parser errors can quote a piece of the request body, so nothing longer than
 * a stored message ever reaches the log.
 */
export function scrubExceptionLogValue(value: unknown, maxLength: number = ERROR_LIMITS.stackLength): unknown {
  if (value === undefined || value === null) return value;
  let text: string;
  if (typeof value === 'string') {
    text = value;
  } else if (value instanceof Error) {
    text = `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ''}`;
  } else {
    try {
      text = JSON.stringify(value) ?? String(value);
    } catch {
      text = String(value);
    }
  }
  return truncate(scrubPii(text, maxLength * 2), maxLength);
}

/**
 * The Nest console logger with the request's correlation id after the
 * context, e.g. `[BookingsService] [rid:0b1c...]`. Installed in main.ts,
 * so every existing Logger call carries the id without code changes. Lines
 * of unhandled exceptions (context ExceptionsHandler, written by Nest's
 * default filter with the raw message and stack) pass through the PII
 * scrubber first (H3).
 */
export class RequestContextLogger extends ConsoleLogger {
  protected formatContext(context: string): string {
    const base = super.formatContext(context);
    const requestId = currentRequestId();
    return requestId ? `${base}[rid:${requestId}] ` : base;
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    const context = optionalParams.length > 0 ? optionalParams[optionalParams.length - 1] : undefined;
    if (context !== EXCEPTIONS_HANDLER_CONTEXT) {
      super.error(message, ...optionalParams);
      return;
    }
    const scrubbed = optionalParams.slice(0, -1).map((param) => scrubExceptionLogValue(param));
    super.error(scrubExceptionLogValue(message, ERROR_LIMITS.messageLength), ...scrubbed, context);
  }
}
