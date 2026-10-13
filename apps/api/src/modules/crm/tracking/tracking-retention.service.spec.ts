import { TOUCHPOINT_RETENTION_MONTHS } from '@platform/shared';
import { RETENTION_BATCH_SIZE, RETENTION_MAX_BATCHES, TrackingRetentionService, retentionCutoff } from './tracking-retention.service';
import type { PrismaService } from '../../prisma/prisma.service';

function build(counts: number[]) {
  const queue = [...counts];
  const executeRaw = jest.fn().mockImplementation(async () => queue.shift() ?? 0);
  const service = new TrackingRetentionService({ $executeRaw: executeRaw } as unknown as PrismaService);
  return { service, executeRaw };
}

describe('retentionCutoff', () => {
  it('uses the shared 13 month constant', () => {
    expect(TOUCHPOINT_RETENTION_MONTHS).toBe(13);
    expect(retentionCutoff(new Date('2026-10-13T08:30:00Z')).toISOString()).toBe('2025-09-13T08:30:00.000Z');
  });
  it('clamps the day to the target month length', () => {
    expect(retentionCutoff(new Date('2026-03-31T00:00:00Z'), 13).toISOString()).toBe('2025-02-28T00:00:00.000Z');
    expect(retentionCutoff(new Date('2026-01-15T00:00:00Z')).toISOString()).toBe('2024-12-15T00:00:00.000Z');
  });
});

describe('TrackingRetentionService', () => {
  const now = new Date('2026-10-13T08:00:00Z');

  it('stops each table at the first partial batch', async () => {
    const { service, executeRaw } = build([RETENTION_BATCH_SIZE, 120, 40]);
    const result = await service.run(now);
    expect(result).toEqual({ touchpointsDeleted: RETENTION_BATCH_SIZE + 120, visitorsDeleted: 40, ran: true });
    expect(executeRaw).toHaveBeenCalledTimes(3);
  });

  it('passes the 13 month cutoff and the batch size to the statements', async () => {
    const { service, executeRaw } = build([0, 0]);
    await service.run(now);
    const [, cutoff, limit] = executeRaw.mock.calls[0] as [unknown, Date, number];
    expect(cutoff.toISOString()).toBe('2025-09-13T08:00:00.000Z');
    expect(limit).toBe(RETENTION_BATCH_SIZE);
    expect(String((executeRaw.mock.calls[1] as [string[]])[0].join('?'))).not.toContain('contact_id');
  });

  it('caps the statements per table and keeps going on the next heartbeat', async () => {
    const full = Array.from({ length: RETENTION_MAX_BATCHES * 2 + 5 }, () => RETENTION_BATCH_SIZE);
    const { service, executeRaw } = build(full);
    const first = await service.run(now);
    expect(executeRaw).toHaveBeenCalledTimes(RETENTION_MAX_BATCHES * 2);
    expect(first.touchpointsDeleted).toBe(RETENTION_BATCH_SIZE * RETENTION_MAX_BATCHES);
    const second = await service.run(new Date(now.getTime() + 15 * 60 * 1000));
    expect(second.ran).toBe(true);
  });

  it('runs once a day after the backlog is drained', async () => {
    const { service, executeRaw } = build([0, 0]);
    await service.run(now);
    const skipped = await service.run(new Date(now.getTime() + 15 * 60 * 1000));
    expect(skipped).toEqual({ touchpointsDeleted: 0, visitorsDeleted: 0, ran: false });
    expect(executeRaw).toHaveBeenCalledTimes(2);
    const next = await service.run(new Date(now.getTime() + 24 * 60 * 60 * 1000));
    expect(next.ran).toBe(true);
  });
});
