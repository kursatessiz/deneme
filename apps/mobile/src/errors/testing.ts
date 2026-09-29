import type { ClientErrorEvent } from '@platform/shared';

import type { KeyValueStorage } from './queue';

/** In-memory storage for the queue and reporter tests. */
export class FakeStorage implements KeyValueStorage {
  readonly data = new Map<string, string>();
  writes = 0;
  failWrites = false;

  async getItem(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }
  async setItem(key: string, value: string): Promise<void> {
    if (this.failWrites) throw new Error('disk full');
    this.writes++;
    this.data.set(key, value);
  }
  async removeItem(key: string): Promise<void> {
    this.data.delete(key);
  }
}

export function makeEvent(index: number, overrides: Partial<ClientErrorEvent> = {}): ClientErrorEvent {
  const hex = index.toString(16).padStart(12, '0');
  return {
    eventId: `00000000-0000-4000-8000-${hex}`,
    source: 'mobile',
    severity: 'error',
    release: '1.0.0',
    environment: 'production',
    type: 'Error',
    message: `failure ${index}`,
    timestamp: new Date(1_700_000_000_000 + index * 1000).toISOString(),
    ...overrides,
  };
}
