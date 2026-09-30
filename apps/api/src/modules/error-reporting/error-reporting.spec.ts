import { ConfigService } from '@nestjs/config';
import type { ErrorEventRecord } from '@platform/shared';
import { CAPTURE_QUEUE_LIMIT, ErrorCaptureService } from './error-capture.service';
import { ErrorAlertsService } from './error-alerts.service';
import { ErrorAlertMailer } from './error-alert-mailer.service';
import type { ErrorSink } from './error-sink';
import type { RecordedError } from './error-store.service';
import { resolveRequestId, runWithRequestContext } from './request-context';

function config(values: Record<string, unknown> = {}): ConfigService {
  const all: Record<string, unknown> = { APP_RELEASE: 'sha-test', NODE_ENV: 'test', JWT_SECRET: 'x'.repeat(32), ...values };
  return { get: (key: string) => all[key] } as unknown as ConfigService;
}

class MemorySink implements ErrorSink {
  readonly name = 'memory';
  readonly events: ErrorEventRecord[] = [];
  async write(event: ErrorEventRecord): Promise<void> {
    this.events.push(event);
  }
}

describe('ErrorCaptureService', () => {
  it('scrubs, tags with the request id and hashes the user id', async () => {
    const sink = new MemorySink();
    const capture = new ErrorCaptureService(config(), [sink]);
    const id = runWithRequestContext({ requestId: '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d' }, () =>
      capture.capture({ source: 'api', error: new Error('mail ada@example.com'), userId: 'user-1', studioId: 's1' }),
    );
    expect(id).not.toBeNull();
    await capture.flush();
    expect(sink.events).toHaveLength(1);
    const [event] = sink.events;
    expect(event.message).toBe('mail [email]');
    expect(event.requestId).toBe('0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d');
    expect(event.release).toBe('sha-test');
    expect(event.userIdHash).toMatch(/^[0-9a-f]{64}$/);
    expect(event.userIdHash).toBe(capture.hashUserId('user-1'));
    expect(JSON.stringify(event)).not.toContain('user-1');
  });

  it('never throws, even when a sink fails', async () => {
    const failing: ErrorSink = { name: 'failing', write: () => Promise.reject(new Error('db down')) };
    const sink = new MemorySink();
    const capture = new ErrorCaptureService(config(), [failing, sink]);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => capture.capture({ source: 'api', error: circular })).not.toThrow();
    await expect(capture.flush()).resolves.toBeUndefined();
    expect(sink.events).toHaveLength(1);
  });

  it('deduplicates the same fingerprint within a second and bounds the queue', () => {
    const capture = new ErrorCaptureService(config(), []);
    expect(capture.capture({ source: 'api', type: 'E', message: 'same' })).not.toBeNull();
    expect(capture.capture({ source: 'api', type: 'E', message: 'same' })).toBeNull();
    // Types are not normalised, so each one is its own fingerprint.
    const letterId = (i: number) => i.toString(26).replace(/[0-9a-p]/g, (d) => 'abcdefghijklmnopqrstuvwxyz'[parseInt(d, 26)]);
    for (let i = 0; i < CAPTURE_QUEUE_LIMIT + 10; i++) capture.capture({ source: 'api', type: `E${letterId(i)}`, message: 'm' });
    expect(capture.droppedCount).toBeGreaterThan(0);
  });

  it('drops events after shutdown', async () => {
    const sink = new MemorySink();
    const capture = new ErrorCaptureService(config(), [sink]);
    await capture.onModuleDestroy();
    expect(capture.capture({ source: 'api', type: 'E', message: 'late' })).toBeNull();
  });
});

describe('request ids', () => {
  it('keeps a valid incoming id and replaces anything else', () => {
    expect(resolveRequestId('0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d')).toBe('0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d');
    expect(resolveRequestId('x\r\ny')).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRequestId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('ErrorAlertsService', () => {
  const recorded = (overrides: Partial<RecordedError> = {}, status = 'OPEN'): RecordedError =>
    ({
      group: { id: 'g1', status, title: 'Error: x', source: 'api', lastRelease: 'r', resolvedInRelease: null, count: 1 },
      eventId: 'e1',
      code: 'ABCDEF12',
      isNew: true,
      regression: false,
      critical: false,
      route: null,
      ...overrides,
    }) as unknown as RecordedError;

  it('picks the alert kind', () => {
    expect(ErrorAlertsService.kindFor({ isNew: true, regression: false, critical: false, status: 'OPEN' })).toBe('NEW');
    expect(ErrorAlertsService.kindFor({ isNew: false, regression: true, critical: true, status: 'OPEN' })).toBe('REGRESSION');
    expect(ErrorAlertsService.kindFor({ isNew: true, regression: false, critical: true, status: 'OPEN' })).toBe('CRITICAL');
    expect(ErrorAlertsService.kindFor({ isNew: false, regression: false, critical: false, status: 'OPEN' })).toBeNull();
    expect(ErrorAlertsService.kindFor({ isNew: true, regression: false, critical: true, status: 'IGNORED' })).toBeNull();
  });

  it('sends once per cooldown window: only the writer that claims lastAlertAt sends', async () => {
    let lastAlertAt: Date | null = null;
    const sent: string[] = [];
    const prisma = {
      errorGroup: {
        updateMany: async ({ where }: { where: { OR: Array<{ lastAlertAt: null | { lt: Date } }> } }) => {
          const cutoff = (where.OR[1].lastAlertAt as { lt: Date }).lt;
          if (lastAlertAt === null || lastAlertAt < cutoff) {
            lastAlertAt = new Date();
            return { count: 1 };
          }
          return { count: 0 };
        },
      },
      user: { findMany: async () => [{ id: 'admin' }] },
      auditLog: { create: async () => ({}) },
    };
    const messaging = { send: async (input: { templateKey: string }) => (sent.push(input.templateKey), { success: true }) };
    const created: string[] = [];
    const service = new ErrorAlertsService(
      prisma as never,
      config({}),
      new ErrorAlertMailer(prisma as never, messaging as never),
      { getCooldownMinutes: async () => 60 } as never,
      { create: async (input: { kind: string }) => (created.push(input.kind), null) } as never,
      {} as never,
    );

    const results = await Promise.all([service.onRecorded(recorded()), service.onRecorded(recorded()), service.onRecorded(recorded({ critical: true }))]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(sent).toHaveLength(1);
    // Past the window the group may alert again.
    lastAlertAt = new Date(Date.now() - 61 * 60 * 1000);
    expect(await service.onRecorded(recorded({ isNew: false, critical: true }))).toBe('CRITICAL');
    expect(sent).toEqual(['ERROR_NEW_GROUP', 'ERROR_CRITICAL']);
    // A new group also becomes a stored alert (once: the second send was a critical repeat, not a new group).
    expect(created).toEqual(['NEW_GROUP']);
  });

  it('sends nothing when alerts are switched off', async () => {
    const service = new ErrorAlertsService({} as never, config({ ERROR_ALERTS_ENABLED: '0' }), {} as never, {} as never, {} as never, {} as never);
    expect(await service.onRecorded(recorded())).toBeNull();
  });
});
