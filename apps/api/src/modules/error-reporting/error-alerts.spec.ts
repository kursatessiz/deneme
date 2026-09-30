import type { ErrorAlertNotification } from '@platform/shared';
import { verifySignatureHeader } from '../webhooks/webhook-signature';
import { outcomeForStatus } from './alert-sinks/alert-sink';
import { AlertHostNotAllowedError } from './alert-sinks/alert-http.client';
import type { AlertHttpRequest } from './alert-sinks/alert-http.client';
import { SlackAlertSink } from './alert-sinks/slack-alert.sink';
import { WebhookAlertSink } from './alert-sinks/webhook-alert.sink';
import { ErrorStoreService, fingerprintHash } from './error-store.service';
import { RequestContextLogger, scrubExceptionLogValue } from './request-context.logger';

const notification: ErrorAlertNotification = {
  alertId: '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d',
  kind: 'SPIKE',
  groupId: '11111111-2222-4333-8444-555555555555',
  title: 'TypeError: x',
  source: 'web',
  release: 'sha-abc',
  code: 'ABCDEF12',
  windowCount: 42,
  baselineMean: 3.5,
  threshold: 18,
  affectedStudioCount: 2,
  occurredAt: '2026-10-29T10:15:00.000Z',
  link: 'https://app.example.com/admin/hatalar/11111111-2222-4333-8444-555555555555',
};

describe('ExceptionsHandler log scrubbing', () => {
  const SECRET_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwxyz012345';

  it('masks e-mail, token and phone in the message and the stack and bounds their length', () => {
    const message = scrubExceptionLogValue(`Unexpected token near {"email":"ada@example.com","token":"${SECRET_JWT}"} call +90 532 123 45 67`, 1000) as string;
    expect(message).not.toContain('ada@example.com');
    expect(message).not.toContain(SECRET_JWT);
    expect(message).toContain('[email]');
    expect(message).toContain('[phone]');
    expect((scrubExceptionLogValue('x'.repeat(50_000), 1000) as string).length).toBe(1000);
    expect(scrubExceptionLogValue(undefined)).toBeUndefined();
  });

  it('serialises a thrown non-Error value through the scrubber', () => {
    expect(scrubExceptionLogValue({ password: 'hunter2hunter2', note: 'ada@example.com' }) as string).not.toContain('ada@example.com');
  });

  it('scrubs only lines written under the ExceptionsHandler context', () => {
    const lines: string[] = [];
    const spy = jest.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    });
    try {
      const logger = new RequestContextLogger();
      logger.error('leak ada@example.com', `at handler (Bearer ${SECRET_JWT})`, 'ExceptionsHandler');
      logger.error('other ada@example.com', undefined, 'SomethingElse');
    } finally {
      spy.mockRestore();
    }
    const output = lines.join('');
    expect(output).toContain('leak [email]');
    expect(output).not.toContain(SECRET_JWT);
    // Other contexts are untouched: this change is about unhandled exceptions only.
    expect(output).toContain('other ada@example.com');
  });
});

describe('ErrorStoreService.resolveGroup (aliases and merge chains)', () => {
  interface G {
    id: string;
    fingerprintHash: string;
    mergedIntoId: string | null;
  }
  const groups: G[] = [
    { id: 'live', fingerprintHash: 'h-live', mergedIntoId: null },
    { id: 'merged', fingerprintHash: 'h-merged', mergedIntoId: 'live' },
    { id: 'chain-a', fingerprintHash: 'h-a', mergedIntoId: 'chain-b' },
    { id: 'chain-b', fingerprintHash: 'h-b', mergedIntoId: 'live' },
    { id: 'loop-a', fingerprintHash: 'h-la', mergedIntoId: 'loop-b' },
    { id: 'loop-b', fingerprintHash: 'h-lb', mergedIntoId: 'loop-a' },
  ];
  const aliases = new Map([['h-alias', 'live']]);
  const prisma = {
    errorGroupAlias: { findUnique: async ({ where }: { where: { fingerprintHash: string } }) => (aliases.has(where.fingerprintHash) ? { groupId: aliases.get(where.fingerprintHash) } : null) },
    errorGroup: {
      findUnique: async ({ where }: { where: { id?: string; fingerprintHash?: string } }) => groups.find((g) => (where.id ? g.id === where.id : g.fingerprintHash === where.fingerprintHash)) ?? null,
    },
  };
  const store = new ErrorStoreService(prisma as never);

  it('finds a live group by its own fingerprint', async () => {
    expect((await store.resolveGroup('h-live'))?.id).toBe('live');
    expect(await store.resolveGroup('unknown')).toBeNull();
  });

  it('lets an alias win and follows merged groups to the live one', async () => {
    expect((await store.resolveGroup('h-alias'))?.id).toBe('live');
    expect((await store.resolveGroup('h-merged'))?.id).toBe('live');
    expect((await store.resolveGroup('h-a'))?.id).toBe('live');
  });

  it('refuses a merge cycle instead of looping', async () => {
    expect(await store.resolveGroup('h-la')).toBeNull();
  });

  it('hashes fingerprints with sha256 hex', () => {
    expect(fingerprintHash('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('alert sinks', () => {
  class StubHttp {
    calls: AlertHttpRequest[] = [];
    status = 200;
    async post(request: AlertHttpRequest): Promise<{ status: number }> {
      this.calls.push(request);
      if (request.allowedHosts && !request.allowedHosts.includes(new URL(request.url).hostname)) throw new AlertHostNotAllowedError();
      return { status: this.status };
    }
  }

  it('signs the webhook body so the receiver can verify it', async () => {
    const http = new StubHttp();
    const sink = new WebhookAlertSink({ getWebhookConfig: async () => ({ url: 'https://hooks.example.com/errors', secret: 'super-secret-signing-key' }) } as never, http as never);
    const outcome = await sink.deliver(notification);
    expect(outcome).toEqual({ ok: true, statusCode: 200 });
    const [call] = http.calls;
    expect(call.url).toBe('https://hooks.example.com/errors');
    expect(verifySignatureHeader('super-secret-signing-key', call.body, call.headers['x-signature'])).toBe(true);
    expect(verifySignatureHeader('another-secret-key-value', call.body, call.headers['x-signature'])).toBe(false);
    expect(JSON.parse(call.body)).toMatchObject({ event: 'error.alert', alert: { kind: 'SPIKE', windowCount: 42 } });
  });

  it('is inactive and refuses to deliver without a configuration', async () => {
    const sink = new WebhookAlertSink({ getWebhookConfig: async () => null } as never, new StubHttp() as never);
    expect(await sink.isActive()).toBe(false);
    expect(await sink.deliver(notification)).toMatchObject({ ok: false, retryable: false });
  });

  it('sends Slack only to the allow-listed host', async () => {
    const http = new StubHttp();
    const ok = new SlackAlertSink({ getSlackUrl: async () => 'https://hooks.slack.com/services/T000/B000/xxxx' } as never, http as never);
    expect(await ok.deliver(notification)).toEqual({ ok: true, statusCode: 200 });
    expect(JSON.parse(http.calls[0].body).blocks).toBeDefined();

    const foreign = new SlackAlertSink({ getSlackUrl: async () => 'https://evil.example.com/services/T000/B000/xxxx' } as never, http as never);
    expect(await foreign.deliver(notification)).toMatchObject({ ok: false, error: 'HOST_NOT_ALLOWED', retryable: false });
    expect(http.calls).toHaveLength(1);
  });

  it('classifies HTTP statuses: 5xx, 429 and 408 retry, other 4xx are final', () => {
    expect(outcomeForStatus(204)).toEqual({ ok: true, statusCode: 204 });
    expect(outcomeForStatus(503)).toMatchObject({ ok: false, retryable: true });
    expect(outcomeForStatus(429)).toMatchObject({ ok: false, retryable: true });
    expect(outcomeForStatus(408)).toMatchObject({ ok: false, retryable: true });
    expect(outcomeForStatus(400)).toMatchObject({ ok: false, retryable: false });
    expect(outcomeForStatus(302)).toMatchObject({ ok: false, retryable: false });
  });
});
