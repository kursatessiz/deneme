import { HttpException } from '@nestjs/common';
import { Prisma } from '@platform/database';
import { PUBLIC_IDEMPOTENCY_TTL_HOURS } from '@platform/shared';
import type { PrismaService } from '../prisma/prisma.service';
import { PublicIdempotencyService } from './idempotency.service';

interface Row {
  id: string;
  studioId: string;
  apiKeyId: string;
  key: string;
  requestHash: string;
  status: string;
  responseStatus: number | null;
  responseBody: unknown;
  createdAt: Date;
  expiresAt: Date;
}

/** An in-memory stand-in for the publicApiIdempotencyKey delegate, with the unique (studioId, key) constraint. */
function fakePrisma() {
  const rows: Row[] = [];
  let seq = 0;
  const delegate = {
    deleteMany: jest.fn(async ({ where }: { where: { expiresAt?: { lte: Date }; id?: string; status?: string } }) => {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i];
        const hit =
          (where.expiresAt && r.expiresAt <= where.expiresAt.lte) || (where.id !== undefined && r.id === where.id && (where.status === undefined || r.status === where.status));
        if (hit) rows.splice(i, 1);
      }
      return { count: before - rows.length };
    }),
    create: jest.fn(async ({ data }: { data: { studioId: string; apiKeyId: string; key: string; requestHash: string; expiresAt: Date } }) => {
      if (rows.some((r) => r.studioId === data.studioId && r.key === data.key)) {
        throw new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' });
      }
      const row: Row = { id: `row-${++seq}`, ...data, status: 'IN_PROGRESS', responseStatus: null, responseBody: null, createdAt: new Date() };
      rows.push(row);
      return { id: row.id };
    }),
    findUnique: jest.fn(async ({ where }: { where: { studioId_key: { studioId: string; key: string } } }) => rows.find((r) => r.studioId === where.studioId_key.studioId && r.key === where.studioId_key.key) ?? null),
    update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
      const row = rows.find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return row;
    }),
  };
  return { rows, prisma: { publicApiIdempotencyKey: delegate } as unknown as PrismaService };
}

describe('PublicIdempotencyService', () => {
  const STUDIO = 'studio-1';
  const KEY_ID = 'apikey-1';

  it('runs the work without storing anything when there is no key', async () => {
    const { prisma, rows } = fakePrisma();
    const work = jest.fn().mockResolvedValue({ status: 201, body: { ok: true } });
    const res = await new PublicIdempotencyService(prisma).run(STUDIO, KEY_ID, undefined, 'h', work);
    expect(res).toEqual({ status: 201, body: { ok: true }, replayed: false });
    expect(rows).toHaveLength(0);
  });

  it('stores the response for 24 hours and replays it for the same key and request', async () => {
    const { prisma, rows } = fakePrisma();
    const service = new PublicIdempotencyService(prisma);
    const now = new Date('2026-10-27T10:00:00.000Z');
    const work = jest.fn().mockResolvedValue({ status: 201, body: { id: 'c1' } });

    const first = await service.run(STUDIO, KEY_ID, 'key-12345678', 'hash-a', work, now);
    expect(first).toEqual({ status: 201, body: { id: 'c1' }, replayed: false });
    expect(rows[0].status).toBe('DONE');
    expect(rows[0].expiresAt.getTime() - now.getTime()).toBe(PUBLIC_IDEMPOTENCY_TTL_HOURS * 3600_000);

    const second = await service.run(STUDIO, KEY_ID, 'key-12345678', 'hash-a', work, now);
    expect(second).toEqual({ status: 201, body: { id: 'c1' }, replayed: true });
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('refuses the same key with a different request', async () => {
    const { prisma } = fakePrisma();
    const service = new PublicIdempotencyService(prisma);
    await service.run(STUDIO, KEY_ID, 'key-12345678', 'hash-a', async () => ({ status: 200, body: {} }));
    const err = await service.run(STUDIO, KEY_ID, 'key-12345678', 'hash-b', async () => ({ status: 200, body: {} })).catch((e: HttpException) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(422);
    expect((err as HttpException).getResponse()).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('answers 409 to a parallel request while the first one is still running', async () => {
    const { prisma } = fakePrisma();
    const service = new PublicIdempotencyService(prisma);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = service.run(STUDIO, KEY_ID, 'key-12345678', 'hash-a', async () => {
      await gate;
      return { status: 201, body: { id: 'c1' } };
    });
    await new Promise((r) => setImmediate(r));
    const parallel = await service.run(STUDIO, KEY_ID, 'key-12345678', 'hash-a', async () => ({ status: 201, body: {} })).catch((e: HttpException) => e);
    expect((parallel as HttpException).getStatus()).toBe(409);
    expect((parallel as HttpException).getResponse()).toMatchObject({ code: 'IDEMPOTENCY_IN_PROGRESS' });
    release();
    await expect(slow).resolves.toMatchObject({ replayed: false });
  });

  it('releases the claim when the work fails, so the caller can fix the request and retry with the same key', async () => {
    const { prisma, rows } = fakePrisma();
    const service = new PublicIdempotencyService(prisma);
    await expect(service.run(STUDIO, KEY_ID, 'key-12345678', 'hash-a', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(rows).toHaveLength(0);
    const retry = await service.run(STUDIO, KEY_ID, 'key-12345678', 'hash-a', async () => ({ status: 200, body: { ok: true } }));
    expect(retry.replayed).toBe(false);
  });

  it('forgets a record after its 24 hours and does the work again', async () => {
    const { prisma } = fakePrisma();
    const service = new PublicIdempotencyService(prisma);
    const t0 = new Date('2026-10-27T10:00:00.000Z');
    const work = jest.fn().mockResolvedValue({ status: 201, body: { id: 'c1' } });
    await service.run(STUDIO, KEY_ID, 'key-12345678', 'hash-a', work, t0);
    const later = new Date(t0.getTime() + PUBLIC_IDEMPOTENCY_TTL_HOURS * 3600_000 + 1000);
    const again = await service.run(STUDIO, KEY_ID, 'key-12345678', 'hash-a', work, later);
    expect(again.replayed).toBe(false);
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('keeps keys of different studios apart', async () => {
    const { prisma } = fakePrisma();
    const service = new PublicIdempotencyService(prisma);
    const work = jest.fn().mockResolvedValue({ status: 201, body: {} });
    await service.run('studio-a', KEY_ID, 'key-12345678', 'hash-a', work);
    const other = await service.run('studio-b', 'apikey-2', 'key-12345678', 'hash-a', work);
    expect(other.replayed).toBe(false);
    expect(work).toHaveBeenCalledTimes(2);
  });
});
