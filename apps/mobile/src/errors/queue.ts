import { ERROR_LIMITS } from '@platform/shared';
import type { ClientErrorEvent } from '@platform/shared';

/** The subset of AsyncStorage the queue needs (a fake in tests). */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Events kept on the device while offline; beyond this the oldest are dropped. */
export const ERROR_QUEUE_CAP = 50;
export const ERROR_QUEUE_KEY = 'platform.errors.queue';

/**
 * What the sender says about a batch: 'sent' (remove), 'retry' (keep, stop:
 * offline, rate limited or a server error) or 'drop' (the API rejected the
 * batch as invalid; retrying would loop forever).
 */
export type SendResult = 'sent' | 'retry' | 'drop';
export type BatchSender = (batch: ClientErrorEvent[]) => Promise<SendResult>;

/** Leaves room for the JSON envelope inside the API's 64 KB body limit. */
const BATCH_BYTES = ERROR_LIMITS.batchBytes - 1024;

function isStoredEvent(value: unknown): value is ClientErrorEvent {
  return typeof value === 'object' && value !== null && typeof (value as { eventId?: unknown }).eventId === 'string';
}

/**
 * Persistent, bounded, ordered queue of error events (H2). Writes are
 * serialised; flush() sends the oldest events first in batches that respect
 * the ingest limits (20 events, 64 KB) and removes only what the API
 * accepted, so a crash or a failed send never loses or reorders events.
 * Nothing here throws to the caller.
 */
export class ErrorQueue {
  private chain: Promise<unknown> = Promise.resolve();
  private flushing: Promise<{ sent: number; remaining: number }> | null = null;

  constructor(
    private readonly storage: KeyValueStorage,
    private readonly cap: number = ERROR_QUEUE_CAP,
    private readonly key: string = ERROR_QUEUE_KEY,
  ) {}

  /** Runs `task` after every earlier queue write; a failure of one task does not block the next. */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async load(): Promise<ClientErrorEvent[]> {
    try {
      const raw = await this.storage.getItem(this.key);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isStoredEvent) : [];
    } catch {
      return [];
    }
  }

  private async save(events: ClientErrorEvent[]): Promise<void> {
    try {
      if (events.length === 0) await this.storage.removeItem(this.key);
      else await this.storage.setItem(this.key, JSON.stringify(events));
    } catch {
      // A full or unavailable disk: the event is lost, the app keeps running.
    }
  }

  /** Appends an event, dropping the oldest ones beyond the cap. Resolves once persisted. */
  enqueue(event: ClientErrorEvent): Promise<void> {
    return this.serial(async () => {
      const events = await this.load();
      if (events.some((e) => e.eventId === event.eventId)) return;
      events.push(event);
      if (events.length > this.cap) events.splice(0, events.length - this.cap);
      await this.save(events);
    });
  }

  size(): Promise<number> {
    return this.serial(async () => (await this.load()).length);
  }

  /** Sends everything queued, oldest first. Concurrent calls share one run. */
  flush(send: BatchSender): Promise<{ sent: number; remaining: number }> {
    if (!this.flushing) {
      this.flushing = this.runFlush(send).finally(() => {
        this.flushing = null;
      });
    }
    return this.flushing;
  }

  private async runFlush(send: BatchSender): Promise<{ sent: number; remaining: number }> {
    let sent = 0;
    for (;;) {
      const batch = await this.serial(async () => this.takeBatch(await this.load()));
      if (batch.length === 0) break;
      let result: SendResult;
      try {
        result = await send(batch);
      } catch {
        result = 'retry';
      }
      if (result === 'retry') break;
      const gone = new Set(batch.map((e) => e.eventId));
      await this.serial(async () => this.save((await this.load()).filter((e) => !gone.has(e.eventId))));
      if (result === 'sent') sent += batch.length;
    }
    return { sent, remaining: await this.size() };
  }

  /** The oldest events that fit one request: at most batchItems events and BATCH_BYTES of JSON. */
  private takeBatch(events: ClientErrorEvent[]): ClientErrorEvent[] {
    const batch: ClientErrorEvent[] = [];
    let bytes = 0;
    for (const event of events) {
      const size = JSON.stringify(event).length + 1;
      if (batch.length > 0 && (batch.length >= ERROR_LIMITS.batchItems || bytes + size > BATCH_BYTES)) break;
      batch.push(event);
      bytes += size;
    }
    return batch;
  }
}
