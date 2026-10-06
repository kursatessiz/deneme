import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@platform/database';
import { PUBLIC_IDEMPOTENCY_TTL_HOURS } from '@platform/shared';
import type { PublicApiErrorCode } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { classifyExistingClaim } from './idempotency.util';
import { apiErrorWithCode } from '../../common/api-error';
import type { ApiErrorKey } from '@platform/shared';

export interface StoredResponse {
  status: number;
  body: unknown;
}

export interface IdempotentResult extends StoredResponse {
  /** True when the response was replayed from an earlier request with the same key. */
  replayed: boolean;
}

function publicApiError(status: HttpStatus, code: PublicApiErrorCode, key: ApiErrorKey): HttpException {
  return new HttpException(apiErrorWithCode(code, key, undefined, { statusCode: status }), status);
}

/**
 * Idempotency-Key handling of the public write endpoints (M4c). The key is
 * claimed by inserting a row before the work runs (unique per studio and
 * key), so two parallel requests cannot both do the work; a finished
 * request stores its response and later requests with the same key and the
 * same method, path and body get that response back. The same key with a
 * different request is refused, an unfinished claim answers 409, and a
 * failed request releases its claim so the caller can fix it and retry.
 * Records live for PUBLIC_IDEMPOTENCY_TTL_HOURS hours.
 */
@Injectable()
export class PublicIdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async run(
    studioId: string,
    apiKeyId: string,
    key: string | undefined,
    requestHash: string,
    work: () => Promise<StoredResponse>,
    now = new Date(),
  ): Promise<IdempotentResult> {
    if (!key) return { ...(await work()), replayed: false };

    await this.prisma.publicApiIdempotencyKey.deleteMany({ where: { expiresAt: { lte: now } } });
    const claim = await this.claim(studioId, apiKeyId, key, requestHash, now);
    if (claim.kind === 'REPLAY') return { status: claim.response.status, body: claim.response.body, replayed: true };

    try {
      const response = await work();
      await this.prisma.publicApiIdempotencyKey.update({
        where: { id: claim.id },
        data: { status: 'DONE', responseStatus: response.status, responseBody: (response.body ?? Prisma.JsonNull) as Prisma.InputJsonValue },
      });
      return { ...response, replayed: false };
    } catch (err) {
      await this.prisma.publicApiIdempotencyKey.deleteMany({ where: { id: claim.id } });
      throw err;
    }
  }

  private async claim(
    studioId: string,
    apiKeyId: string,
    key: string,
    requestHash: string,
    now: Date,
    retried = false,
  ): Promise<{ kind: 'NEW'; id: string } | { kind: 'REPLAY'; response: StoredResponse }> {
    try {
      const row = await this.prisma.publicApiIdempotencyKey.create({
        data: { studioId, apiKeyId, key, requestHash, expiresAt: new Date(now.getTime() + PUBLIC_IDEMPOTENCY_TTL_HOURS * 3600_000) },
        select: { id: true },
      });
      return { kind: 'NEW', id: row.id };
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    }
    const existing = await this.prisma.publicApiIdempotencyKey.findUnique({ where: { studioId_key: { studioId, key } } });
    // Deleted between the failed insert and now (a failed request released it): claim again once.
    if (!existing) return retried ? this.raceLost() : this.claim(studioId, apiKeyId, key, requestHash, now, true);
    const state = classifyExistingClaim(existing, requestHash, now);
    if (state.kind === 'MISMATCH') throw publicApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'IDEMPOTENCY_KEY_REUSED', 'apiErrors.publicApi.idempotencyKeyReused');
    if (state.kind === 'REPLAY') return { kind: 'REPLAY', response: { status: existing.responseStatus ?? 200, body: existing.responseBody } };
    if (state.kind === 'STALE' && !retried) {
      await this.prisma.publicApiIdempotencyKey.deleteMany({ where: { id: existing.id, status: 'IN_PROGRESS' } });
      return this.claim(studioId, apiKeyId, key, requestHash, now, true);
    }
    throw publicApiError(HttpStatus.CONFLICT, 'IDEMPOTENCY_IN_PROGRESS', 'apiErrors.publicApi.idempotencyInProgress');
  }

  private raceLost(): never {
    throw publicApiError(HttpStatus.CONFLICT, 'IDEMPOTENCY_IN_PROGRESS', 'apiErrors.publicApi.idempotencyInProgress');
  }
}
