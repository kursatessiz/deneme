import { ClientErrorEventSchema, errorCodeFromId } from '@platform/shared';
import type { ClientErrorEvent } from '@platform/shared';

import { BreadcrumbBuffer, trackRequest } from './breadcrumbs';
import { ERROR_QUEUE_KEY } from './queue';
import type { SendResult } from './queue';
import { MAX_EVENTS_PER_SESSION, createMobileReporter, randomUuid } from './reporterCore';
import { FakeStorage } from './testing';

interface Harness {
  storage: FakeStorage;
  breadcrumbs: BreadcrumbBuffer;
  sent: ClientErrorEvent[][];
  timers: Array<{ fn: () => void; ms: number }>;
  reporter: ReturnType<typeof createMobileReporter>;
  results: SendResult[];
  clock: { now: number };
}

function harness(options: { sampleRate?: number; route?: string | null } = {}): Harness {
  const storage = new FakeStorage();
  const breadcrumbs = new BreadcrumbBuffer(() => 1_700_000_000_000);
  const sent: ClientErrorEvent[][] = [];
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const results: SendResult[] = [];
  const clock = { now: 1_700_000_000_000 };
  const reporter = createMobileReporter({
    storage,
    breadcrumbs,
    now: () => clock.now,
    sampleRate: options.sampleRate,
    schedule: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    getContext: () => ({ release: '1.2.3-abc', environment: 'preprod', route: options.route === undefined ? '/(app)/sessions/0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d' : options.route }),
    send: async (batch) => {
      sent.push(batch);
      return results.shift() ?? 'sent';
    },
  });
  return { storage, breadcrumbs, sent, timers, reporter, results, clock };
}

async function queued(h: Harness): Promise<ClientErrorEvent[]> {
  return JSON.parse(h.storage.data.get(ERROR_QUEUE_KEY) ?? '[]') as ClientErrorEvent[];
}

describe('createMobileReporter', () => {
  it('builds a schema-valid mobile event with release, environment, route and the short code', async () => {
    const h = harness();
    const { code, persisted } = h.reporter.report(new TypeError('cannot read x'));
    await persisted;
    const [event] = await queued(h);
    expect(ClientErrorEventSchema.safeParse(event).success).toBe(true);
    expect(event).toMatchObject({
      source: 'mobile',
      severity: 'error',
      release: '1.2.3-abc',
      environment: 'preprod',
      type: 'TypeError',
      message: 'cannot read x',
      route: '/(app)/sessions/:id',
    });
    expect(code).toBe(errorCodeFromId(event.eventId));
    expect(code).toMatch(/^[0-9A-F]{8}$/);
  });

  it('applies the shared PII scrubber to message, stack, extra and breadcrumbs', async () => {
    const h = harness();
    h.breadcrumbs.add('click', 'button call +90 532 123 45 67', { note: 'mail ada@example.com' });
    const error = new Error('failed for ada@example.com with token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlMTIz');
    error.stack = 'Error: x\n    at fn (index.android.bundle:1:2) user=ada@example.com';
    const { persisted } = h.reporter.report(error, { extra: 'phone 0532 123 45 67' });
    await persisted;
    const raw = h.storage.data.get(ERROR_QUEUE_KEY) ?? '';
    expect(raw).not.toContain('ada@example.com');
    expect(raw).not.toContain('123 45 67');
    expect(raw).not.toContain('eyJhbGci');
    expect(raw).toContain('[email]');
    expect(raw).toContain('[phone]');
    expect(raw).toContain('[token]');
  });

  it('includes the breadcrumbs recorded before the error (at most 20)', async () => {
    const h = harness();
    for (let i = 0; i < 25; i++) h.breadcrumbs.add('navigation', `/screen/${i}`);
    trackRequest(h.breadcrumbs, 'POST', '/studios/0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d/bookings?token=secret', 500);
    trackRequest(h.breadcrumbs, 'POST', '/telemetry/errors', 202);
    const { persisted } = h.reporter.report(new Error('x'));
    await persisted;
    const [event] = await queued(h);
    expect(event.breadcrumbs).toHaveLength(20);
    const last = event.breadcrumbs?.[event.breadcrumbs.length - 1];
    expect(last).toMatchObject({ type: 'request', message: '/studios/:id/bookings', data: { method: 'POST', status: '500' } });
    expect(JSON.stringify(event)).not.toContain('secret');
    expect(JSON.stringify(event)).not.toContain('/telemetry/errors');
  });

  it('deduplicates within a second, reports one event per error object and shows the same code', async () => {
    const h = harness();
    const error = new Error('same');
    const first = h.reporter.report(error);
    const second = h.reporter.report(error);
    expect(second.code).toBe(first.code);
    expect(h.reporter.report(new Error('same')).code).toBeNull();
    await first.persisted;
    expect(await queued(h)).toHaveLength(1);
    h.clock.now += 5000;
    expect(h.reporter.report(new Error('same')).code).not.toBeNull();
  });

  it('caps the events of one session', async () => {
    const h = harness();
    let accepted = 0;
    for (let i = 0; i < MAX_EVENTS_PER_SESSION + 10; i++) {
      h.clock.now += 5000;
      if (h.reporter.report(new Error(`distinct failure number ${'x'.repeat(i)}`)).code) accepted++;
    }
    expect(accepted).toBe(MAX_EVENTS_PER_SESSION);
  });

  it('honours the sample rate', () => {
    expect(harness({ sampleRate: 0 }).reporter.report(new Error('x')).code).toBeNull();
    expect(harness({ sampleRate: 1 }).reporter.report(new Error('x')).code).not.toBeNull();
  });

  it('flushes shortly after an error and retries with backoff while offline, one timer at a time', async () => {
    const h = harness();
    h.results.push('retry', 'retry');
    const { persisted } = h.reporter.report(new Error('offline failure'));
    await persisted;
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0].ms).toBe(1000);

    h.timers.shift()?.fn();
    await h.reporter.flush();
    expect(h.sent).toHaveLength(1);
    expect(await queued(h)).toHaveLength(1);
    const retry = h.timers.filter((t) => t.ms >= 30_000);
    expect(retry).toHaveLength(1);
    expect(retry[0].ms).toBe(30_000);

    // Another explicit flush (app foreground) does not stack a second retry timer.
    await h.reporter.flush();
    expect(h.timers.filter((t) => t.ms >= 30_000)).toHaveLength(1);

    // Connectivity is back: the next flush delivers and empties the queue.
    await h.reporter.flush();
    expect(await queued(h)).toHaveLength(0);
  });

  it('sends events queued by an earlier app run', async () => {
    const h = harness();
    const { persisted } = h.reporter.report(new Error('crash before restart'));
    await persisted;
    const again = harness();
    again.storage.data.set(ERROR_QUEUE_KEY, h.storage.data.get(ERROR_QUEUE_KEY) ?? '[]');
    await again.reporter.flush();
    expect(again.sent).toHaveLength(1);
    expect(again.sent[0][0].message).toBe('crash before restart');
  });

  it('never throws, even when storage fails', async () => {
    const h = harness();
    h.storage.failWrites = true;
    const { code, persisted } = h.reporter.report(new Error('disk full'));
    expect(code).not.toBeNull();
    await expect(persisted).resolves.toBeUndefined();
    expect(() => h.reporter.report({ toJSON: () => { throw new Error('bad'); } })).not.toThrow();
  });
});

describe('randomUuid', () => {
  it('produces RFC 4122 v4 ids', () => {
    expect(randomUuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(randomUuid(() => 0)).toBe('00000000-0000-4000-8000-000000000000');
  });
});
