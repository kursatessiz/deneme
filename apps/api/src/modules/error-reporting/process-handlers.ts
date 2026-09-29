import type { Logger } from '@nestjs/common';
import type { ErrorCaptureService } from './error-capture.service';

/** How long a crashing process waits for the captured error to be stored. */
const FLUSH_TIMEOUT_MS = 2000;

/**
 * Records uncaught exceptions and unhandled rejections, then keeps Node's
 * default outcome for both: the error is printed and the process exits
 * with code 1 (Node exits on an unhandled rejection since v15; the
 * container restart policy brings the API back). Installed from main.ts
 * only, never in tests.
 */
export function installProcessErrorHandlers(capture: ErrorCaptureService, logger: Logger): void {
  let exiting = false;
  const crash = (kind: 'UncaughtException' | 'UnhandledRejection', error: unknown) => {
    if (exiting) return;
    exiting = true;
    capture.capture({ source: 'api', severity: 'fatal', error, type: error instanceof Error ? undefined : kind, route: `process ${kind}` });
    logger.error(`${kind}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    const timer = setTimeout(() => process.exit(1), FLUSH_TIMEOUT_MS);
    capture
      .flush()
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timer);
        process.exit(1);
      });
  };
  process.on('uncaughtException', (error) => crash('UncaughtException', error));
  process.on('unhandledRejection', (reason) => crash('UnhandledRejection', reason));
}
