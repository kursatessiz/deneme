import { ERROR_LIMITS } from '@platform/shared';
import type { ClientErrorEvent } from '@platform/shared';

import { ERROR_QUEUE_CAP, ERROR_QUEUE_KEY, ErrorQueue } from './queue';
import type { SendResult } from './queue';
import { FakeStorage, makeEvent } from './testing';

const messages = (events: ClientErrorEvent[]) => events.map((e) => e.message);

describe('ErrorQueue', () => {
  it('keeps at most 50 events and drops the oldest first', async () => {
    const queue = new ErrorQueue(new FakeStorage());
    for (let i = 0; i < 60; i++) await queue.enqueue(makeEvent(i));
    expect(await queue.size()).toBe(ERROR_QUEUE_CAP);
    const sent: string[] = [];
    await queue.flush(async (batch) => {
      sent.push(...messages(batch));
      return 'sent';
    });
    expect(sent).toHaveLength(ERROR_QUEUE_CAP);
    expect(sent[0]).toBe('failure 10');
    expect(sent[sent.length - 1]).toBe('failure 59');
  });

  it('flushes oldest first in batches of at most 20 events, in order', async () => {
    const queue = new ErrorQueue(new FakeStorage());
    for (let i = 0; i < 45; i++) await queue.enqueue(makeEvent(i));
    const sizes: number[] = [];
    const order: string[] = [];
    const result = await queue.flush(async (batch) => {
      sizes.push(batch.length);
      order.push(...messages(batch));
      return 'sent';
    });
    expect(sizes).toEqual([20, 20, 5]);
    expect(order).toEqual(Array.from({ length: 45 }, (_, i) => `failure ${i}`));
    expect(result).toEqual({ sent: 45, remaining: 0 });
  });

  it('keeps the batch and stops when the send must be retried (offline), then delivers later', async () => {
    const queue = new ErrorQueue(new FakeStorage());
    for (let i = 0; i < 25; i++) await queue.enqueue(makeEvent(i));
    let calls = 0;
    const offline = await queue.flush(async () => {
      calls++;
      return 'retry';
    });
    expect(calls).toBe(1);
    expect(offline).toEqual({ sent: 0, remaining: 25 });

    const delivered: string[] = [];
    await queue.flush(async (batch) => {
      delivered.push(...messages(batch));
      return 'sent';
    });
    expect(delivered).toHaveLength(25);
    expect(delivered[0]).toBe('failure 0');
  });

  it('treats a sender that throws as retry', async () => {
    const queue = new ErrorQueue(new FakeStorage());
    await queue.enqueue(makeEvent(1));
    const result = await queue.flush(async () => {
      throw new Error('boom');
    });
    expect(result).toEqual({ sent: 0, remaining: 1 });
  });

  it('removes a batch the API rejected as invalid without counting it as sent', async () => {
    const queue = new ErrorQueue(new FakeStorage());
    await queue.enqueue(makeEvent(1));
    await queue.enqueue(makeEvent(2));
    const results: SendResult[] = ['drop'];
    const result = await queue.flush(async () => results.shift() ?? 'sent');
    expect(result).toEqual({ sent: 0, remaining: 0 });
  });

  it('survives an app restart: a new queue over the same storage sees the events', async () => {
    const storage = new FakeStorage();
    await new ErrorQueue(storage).enqueue(makeEvent(7));
    expect(storage.data.has(ERROR_QUEUE_KEY)).toBe(true);
    expect(await new ErrorQueue(storage).size()).toBe(1);
  });

  it('delivers events enqueued while a flush is in flight, after the earlier ones', async () => {
    const queue = new ErrorQueue(new FakeStorage());
    await queue.enqueue(makeEvent(1));
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen: string[] = [];
    const flushing = queue.flush(async (batch) => {
      seen.push(...messages(batch));
      await gate;
      return 'sent';
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await queue.enqueue(makeEvent(2));
    release();
    await flushing;
    // The event enqueued mid-flight is not lost and goes out after the first one, in the same run.
    expect(seen).toEqual(['failure 1', 'failure 2']);
    expect(await queue.size()).toBe(0);
  });

  it('shares one run between concurrent flush calls', async () => {
    const queue = new ErrorQueue(new FakeStorage());
    await queue.enqueue(makeEvent(1));
    let calls = 0;
    const send = async (): Promise<SendResult> => {
      calls++;
      return 'sent';
    };
    await Promise.all([queue.flush(send), queue.flush(send)]);
    expect(calls).toBe(1);
  });

  it('splits batches by byte size to respect the 64 KB request limit', async () => {
    const queue = new ErrorQueue(new FakeStorage());
    const big = 'x'.repeat(ERROR_LIMITS.messageLength);
    for (let i = 0; i < 12; i++) {
      await queue.enqueue(makeEvent(i, { message: big, stack: 'y'.repeat(ERROR_LIMITS.stackLength) }));
    }
    const sizes: number[] = [];
    await queue.flush(async (batch) => {
      expect(JSON.stringify({ events: batch }).length).toBeLessThan(ERROR_LIMITS.batchBytes);
      sizes.push(batch.length);
      return 'sent';
    });
    expect(sizes.length).toBeGreaterThan(1);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(12);
  });

  it('ignores a corrupt stored value and a failing disk', async () => {
    const storage = new FakeStorage();
    storage.data.set(ERROR_QUEUE_KEY, '{not json');
    const queue = new ErrorQueue(storage);
    expect(await queue.size()).toBe(0);
    storage.failWrites = true;
    await expect(queue.enqueue(makeEvent(1))).resolves.toBeUndefined();
  });

  it('does not store the same event twice', async () => {
    const queue = new ErrorQueue(new FakeStorage());
    await queue.enqueue(makeEvent(1));
    await queue.enqueue(makeEvent(1));
    expect(await queue.size()).toBe(1);
  });
});
