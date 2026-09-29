import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AiTranslationJob, Prisma } from '@platform/database';
import {
  BASE_LOCALE,
  BASE_MESSAGES,
  BUNDLED_MESSAGES,
  buildTranslationUnits,
  chunkBatches,
  isAiErrorCode,
  validateTranslatedValue,
  type AiErrorCode,
  type StartTranslationJobInput,
  type TranslationJobDTO,
  type TranslationJobFailureDTO,
  type TranslationJobStatus,
  type TranslationUnit,
} from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { I18nService } from '../../i18n/i18n.service';
import { AiService } from '../ai.service';
import { AiError, TRANSIENT_AI_ERRORS } from '../ai-errors';
import { AiProviderError } from '../providers/ai-provider';
import {
  TRANSLATION_SYSTEM_PROMPT,
  parseTranslationOutput,
  translationLanguageBlock,
  translationUserMessage,
  type TranslatedValue,
} from '../prompts';
import { AiQueueService } from './ai-queue.service';

/** Keys per model request: large enough to amortise the prompt, small enough to stay well under max_tokens. */
export const TRANSLATION_BATCH_SIZE = 50;
/** A key is tried twice (the first attempt and one retry) before it is marked failed. */
export const TRANSLATION_MAX_ATTEMPTS = 2;
/** Worker lease; longer than the worst case of one batch (timeout x SDK retries). */
export const TRANSLATION_LOCK_MS = 10 * 60_000;
/** Consecutive provider outages after which a job gives up. */
export const TRANSLATION_MAX_TRANSIENT_ERRORS = 5;
const BATCH_TIMEOUT_MS = 120_000;
const BATCH_MAX_TOKENS = 16_000;
/** Errors that no retry fixes: the job fails at once. */
const FATAL_ERRORS: ReadonlySet<AiErrorCode> = new Set(['AI_NOT_CONFIGURED', 'AI_AUTH_FAILED', 'AI_BAD_REQUEST']);

export type ItemRejection = TranslationJobFailureDTO['errorCode'];

export interface BatchEvaluation {
  /** Unit id -> key/value pairs to store. */
  accepted: Map<string, Array<{ key: string; value: string }>>;
  rejected: Map<string, ItemRejection>;
}

function normalise(source: string, value: string): string {
  // The model sometimes pads; keep outer whitespace only where the source has it.
  return source === source.trim() ? value.trim() : value;
}

/**
 * Validates a model answer against the units it was asked for: every value
 * must keep the source's placeholders exactly, be plain text and non-empty;
 * a plural unit is accepted only when every requested form passes.
 */
export function evaluateBatch(units: readonly TranslationUnit[], answer: ReadonlyMap<string, TranslatedValue>): BatchEvaluation {
  const accepted = new Map<string, Array<{ key: string; value: string }>>();
  const rejected = new Map<string, ItemRejection>();
  for (const unit of units) {
    const out = answer.get(unit.id);
    if (unit.kind === 'single') {
      if (out?.value === undefined) {
        rejected.set(unit.id, 'MISSING_IN_OUTPUT');
        continue;
      }
      const value = normalise(unit.source, out.value);
      const problem = validateTranslatedValue(unit.source, value);
      if (problem) rejected.set(unit.id, problem);
      else accepted.set(unit.id, [{ key: unit.key, value }]);
      continue;
    }
    if (!out?.forms) {
      rejected.set(unit.id, 'MISSING_IN_OUTPUT');
      continue;
    }
    const writes: Array<{ key: string; value: string }> = [];
    let problem: ItemRejection | null = null;
    for (const category of unit.categories) {
      const source = unit.sourceForms[category] ?? unit.sourceForms.other ?? '';
      const raw = out.forms[category];
      if (raw === undefined) {
        problem = 'MISSING_IN_OUTPUT';
        break;
      }
      const value = normalise(source, raw);
      problem = validateTranslatedValue(source, value);
      if (problem) break;
      writes.push({ key: `${unit.group}.${category}`, value });
    }
    if (problem) rejected.set(unit.id, problem);
    else accepted.set(unit.id, writes);
  }
  return { accepted, rejected };
}

export type ProcessOutcome = { state: 'DONE' } | { state: 'BUSY' } | { state: 'PAUSED'; retryAfterMs: number };

/**
 * Background "translate this language with AI" (G3b, docs/YAPAY_ZEKA.md).
 * A job snapshots the keys to translate as items, then processes them in
 * batches of TRANSLATION_BATCH_SIZE: one model request per batch, every
 * value validated (placeholders, plural forms, plain text) before it is
 * written as an AI TranslationOverride awaiting review. Idempotent and
 * resumable: items carry their own status, a worker holds a time-limited
 * lease, and a crashed or paused run continues where it stopped.
 */
@Injectable()
export class TranslationEngineService {
  private readonly logger = new Logger(TranslationEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly i18n: I18nService,
    private readonly queue: AiQueueService,
  ) {}

  // -- lifecycle ------------------------------------------------------------

  async start(actorUserId: string, locale: string, input: StartTranslationJobInput): Promise<TranslationJobDTO> {
    const language = await this.prisma.language.findUnique({ where: { code: locale } });
    if (!language) throw new NotFoundException(`"${locale}" dili bulunamadı.`);
    if (language.code === BASE_LOCALE) throw new BadRequestException('Temel dil (Türkçe) kaynak olduğu için çevrilmez.');
    await this.ai.assertConfigured();

    const active = await this.prisma.aiTranslationJob.findFirst({ where: { locale: language.code, status: { in: ['QUEUED', 'RUNNING'] } } });
    if (active) {
      throw new ConflictException({ statusCode: 409, message: 'Bu dil için süren bir çeviri işi var.', code: 'TRANSLATION_JOB_ACTIVE', jobId: active.id });
    }

    const units = await this.unitsFor(language.code, input.namespaces, input.overwrite);
    const model = await this.ai.modelFor('TRANSLATION');
    const now = new Date();
    const job = await this.prisma.$transaction(async (tx) => {
      const created = await tx.aiTranslationJob.create({
        data: {
          locale: language.code,
          namespaces: input.namespaces,
          overwrite: input.overwrite,
          total: units.length,
          model,
          createdByUserId: actorUserId,
          ...(units.length === 0 ? { status: 'COMPLETED', startedAt: now, finishedAt: now } : {}),
        },
      });
      for (const batch of chunkBatches(units, 1000)) {
        await tx.aiTranslationJobItem.createMany({ data: batch.map((u) => ({ jobId: created.id, key: u.id, isPlural: u.kind === 'plural' })) });
      }
      await tx.auditLog.create({
        data: {
          userId: actorUserId,
          action: 'ai.translation.start',
          entityType: 'AiTranslationJob',
          entityId: created.id,
          metadata: { locale: language.code, namespaces: input.namespaces, overwrite: input.overwrite, total: units.length, model },
        },
      });
      return created;
    });
    if (units.length > 0) await this.queue.enqueueTranslation(job.id);
    return this.toDTO(job);
  }

  async cancel(actorUserId: string, jobId: string): Promise<TranslationJobDTO> {
    const job = await this.prisma.aiTranslationJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Çeviri işi bulunamadı.');
    if (job.status !== 'QUEUED' && job.status !== 'RUNNING') return this.toDTO(job);
    const now = new Date();
    // The batch in flight (if any) still finishes and is saved; nothing after it runs.
    const updated = await this.prisma.aiTranslationJob.update({
      where: { id: jobId },
      data: { status: 'CANCELLED', cancelRequestedAt: now, finishedAt: now, lockedUntil: null },
    });
    await this.prisma.auditLog.create({
      data: { userId: actorUserId, action: 'ai.translation.cancel', entityType: 'AiTranslationJob', entityId: jobId, metadata: { locale: job.locale } },
    });
    return this.toDTO(updated);
  }

  async get(jobId: string): Promise<TranslationJobDTO> {
    const job = await this.prisma.aiTranslationJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Çeviri işi bulunamadı.');
    return this.toDTO(job);
  }

  async list(locale: string): Promise<TranslationJobDTO[]> {
    const jobs = await this.prisma.aiTranslationJob.findMany({ where: { locale }, orderBy: { createdAt: 'desc' }, take: 10 });
    return Promise.all(jobs.map((job) => this.toDTO(job)));
  }

  /**
   * Super-admin "run now": advances one job in this request for up to
   * `budgetMs`, without running the rest of the scheduler heartbeat. Useful
   * where there is no Redis queue; the job lock keeps it from running twice.
   */
  async runNow(actorUserId: string, jobId: string, budgetMs = 60_000): Promise<TranslationJobDTO> {
    const job = await this.prisma.aiTranslationJob.findUnique({ where: { id: jobId }, select: { id: true, locale: true } });
    if (!job) throw new NotFoundException('Çeviri işi bulunamadı.');
    await this.prisma.auditLog.create({
      data: { userId: actorUserId, action: 'ai.translation.run', entityType: 'AiTranslationJob', entityId: jobId, metadata: { locale: job.locale } },
    });
    await this.processJob(jobId, new Date(Date.now() + budgetMs));
    return this.get(jobId);
  }

  // -- workers ---------------------------------------------------------------

  /** Heartbeat entry point: advances waiting or abandoned jobs until `budgetMs` is used up. */
  async processPending(now: Date, budgetMs = 4 * 60_000): Promise<{ jobs: number; paused: number }> {
    const deadline = new Date(Date.now() + budgetMs);
    const due = await this.prisma.aiTranslationJob.findMany({
      where: { status: { in: ['QUEUED', 'RUNNING'] }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
      orderBy: { createdAt: 'asc' },
      take: 5,
      select: { id: true },
    });
    let jobs = 0;
    let paused = 0;
    for (const { id } of due) {
      if (Date.now() >= deadline.getTime()) break;
      const outcome = await this.processJob(id, deadline);
      if (outcome.state !== 'BUSY') jobs += 1;
      if (outcome.state === 'PAUSED') paused += 1;
    }
    return { jobs, paused };
  }

  /** Runs one job until it is finished, cancelled, paused by a provider outage or `deadline` passes. */
  async processJob(jobId: string, deadline: Date): Promise<ProcessOutcome> {
    const now = new Date();
    const claimed = await this.prisma.aiTranslationJob.updateMany({
      where: { id: jobId, status: { in: ['QUEUED', 'RUNNING'] }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
      data: { status: 'RUNNING', lockedUntil: new Date(now.getTime() + TRANSLATION_LOCK_MS) },
    });
    if (claimed.count === 0) return { state: 'BUSY' };
    await this.prisma.aiTranslationJob.updateMany({ where: { id: jobId, startedAt: null }, data: { startedAt: now } });

    let job = await this.prisma.aiTranslationJob.findUniqueOrThrow({ where: { id: jobId }, include: { language: true } });
    const units = new Map((await this.unitsFor(job.locale, [], true)).map((u) => [u.id, u]));
    const glossary = await this.prisma.aiGlossaryTerm.findMany({ where: { locale: job.locale } });
    const system = [
      TRANSLATION_SYSTEM_PROMPT,
      translationLanguageBlock({ code: job.locale, name: job.language.name, nativeName: job.language.nativeName }, glossary),
    ];

    for (;;) {
      const current = await this.prisma.aiTranslationJob.findUniqueOrThrow({ where: { id: jobId } });
      if (current.status !== 'RUNNING') return { state: 'DONE' };

      const items = await this.prisma.aiTranslationJobItem.findMany({
        where: { jobId, status: 'PENDING' },
        orderBy: [{ attempts: 'asc' }, { key: 'asc' }],
        take: TRANSLATION_BATCH_SIZE,
      });
      if (items.length === 0) {
        await this.finish(jobId, 'COMPLETED', null);
        return { state: 'DONE' };
      }
      if (Date.now() >= deadline.getTime()) {
        await this.release(jobId);
        return { state: 'PAUSED', retryAfterMs: 0 };
      }

      // Keys removed from the code since the job started are skipped.
      const gone = items.filter((i) => !units.has(i.key));
      if (gone.length > 0) {
        await this.prisma.aiTranslationJobItem.updateMany({ where: { id: { in: gone.map((i) => i.id) } }, data: { status: 'SKIPPED' } });
      }
      const batch = items.filter((i) => units.has(i.key));
      const batchUnits = batch.map((i) => units.get(i.key)!);
      if (batchUnits.length === 0) continue;

      await this.prisma.aiTranslationJob.update({ where: { id: jobId }, data: { lockedUntil: new Date(Date.now() + TRANSLATION_LOCK_MS) } });

      let answer: Map<string, TranslatedValue>;
      try {
        const result = await this.ai.run({
          task: 'TRANSLATION',
          studioId: null,
          userId: job.createdByUserId,
          translationJobId: jobId,
          system,
          messages: [{ role: 'user', content: translationUserMessage(batchUnits) }],
          maxTokens: BATCH_MAX_TOKENS,
          timeoutMs: BATCH_TIMEOUT_MS,
        });
        answer = parseTranslationOutput(result.text);
      } catch (err) {
        const code: AiErrorCode = err instanceof AiError || err instanceof AiProviderError ? err.code : 'AI_PROVIDER_UNAVAILABLE';
        if (FATAL_ERRORS.has(code)) {
          await this.finish(jobId, 'FAILED', code);
          return { state: 'DONE' };
        }
        if (TRANSIENT_AI_ERRORS.has(code)) {
          const failures = current.transientErrors + 1;
          if (failures >= TRANSLATION_MAX_TRANSIENT_ERRORS) {
            await this.finish(jobId, 'FAILED', code);
            return { state: 'DONE' };
          }
          await this.prisma.aiTranslationJob.update({ where: { id: jobId }, data: { transientErrors: failures, lastErrorCode: code, lockedUntil: null } });
          return { state: 'PAUSED', retryAfterMs: 60_000 * failures };
        }
        // Unusable answer (invalid JSON, refusal, cut off): counts as an attempt for every key in the batch.
        await this.rejectItems(batch, new Map(batch.map((i) => [i.key, code])));
        await this.refreshCounters(jobId, code);
        continue;
      }

      const evaluation = evaluateBatch(batchUnits, answer);
      job = await this.prisma.aiTranslationJob.findUniqueOrThrow({ where: { id: jobId }, include: { language: true } });
      await this.writeAccepted(job, batch, evaluation);
      await this.rejectItems(
        batch.filter((i) => evaluation.rejected.has(i.key)),
        evaluation.rejected,
      );
      await this.refreshCounters(jobId, null);
      this.i18n.invalidateLocale(job.locale);
    }
  }

  // -- helpers ---------------------------------------------------------------

  private async unitsFor(locale: string, namespaces: readonly string[], overwrite: boolean): Promise<TranslationUnit[]> {
    const reference = locale === 'en' ? null : await this.i18n.effectiveMessages('en');
    const current = await this.i18n.effectiveMessages(locale);
    return buildTranslationUnits({ base: BASE_MESSAGES, reference, current, locale, namespaces, overwrite });
  }

  private async writeAccepted(
    job: AiTranslationJob,
    batch: ReadonlyArray<{ id: string; key: string }>,
    evaluation: BatchEvaluation,
  ): Promise<void> {
    const bundled: Readonly<Record<string, string>> = BUNDLED_MESSAGES[job.locale] ?? {};
    const keys = [...evaluation.accepted.values()].flat().map((w) => w.key);
    const existing = await this.prisma.translationOverride.findMany({ where: { locale: job.locale, key: { in: keys } } });
    const existingByKey = new Map(existing.map((o) => [o.key, o]));
    const ops: Prisma.PrismaPromise<unknown>[] = [];

    for (const item of batch) {
      const writes = evaluation.accepted.get(item.key);
      if (!writes) continue;
      // Without "overwrite", a value a person entered while the job ran wins.
      const humanValue = !job.overwrite && writes.some((w) => {
        const row = existingByKey.get(w.key);
        return row !== undefined && row.source !== 'AI';
      });
      if (humanValue) {
        ops.push(this.prisma.aiTranslationJobItem.update({ where: { id: item.id }, data: { status: 'SKIPPED' } }));
        continue;
      }
      for (const { key, value } of writes) {
        const sameAsBundled = Object.prototype.hasOwnProperty.call(bundled, key) && bundled[key] === value;
        if (sameAsBundled) {
          // Stored overrides equal to the shipped value are redundant (same rule as the CMS).
          ops.push(this.prisma.translationOverride.deleteMany({ where: { locale: job.locale, key } }));
          continue;
        }
        const data = { value, source: 'AI' as const, reviewedAt: null, updatedByUserId: job.createdByUserId };
        ops.push(
          this.prisma.translationOverride.upsert({
            where: { locale_key: { locale: job.locale, key } },
            create: { locale: job.locale, key, ...data },
            update: data,
          }),
        );
      }
      ops.push(this.prisma.aiTranslationJobItem.update({ where: { id: item.id }, data: { status: 'DONE', errorCode: null } }));
    }
    if (ops.length > 0) await this.prisma.$transaction(ops);
  }

  private async rejectItems(
    items: ReadonlyArray<{ id: string; key: string; attempts: number }>,
    reasons: ReadonlyMap<string, ItemRejection>,
  ): Promise<void> {
    if (items.length === 0) return;
    await this.prisma.$transaction(
      items.map((item) => {
        const attempts = item.attempts + 1;
        return this.prisma.aiTranslationJobItem.update({
          where: { id: item.id },
          data: {
            attempts,
            errorCode: reasons.get(item.key) ?? 'AI_INVALID_OUTPUT',
            status: attempts >= TRANSLATION_MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
          },
        });
      }),
    );
  }

  private async refreshCounters(jobId: string, lastErrorCode: AiErrorCode | null): Promise<void> {
    const groups = await this.prisma.aiTranslationJobItem.groupBy({ by: ['status'], where: { jobId }, _count: { _all: true } });
    const count = (status: string) => groups.find((g) => g.status === status)?._count._all ?? 0;
    await this.prisma.aiTranslationJob.update({
      where: { id: jobId },
      data: {
        done: count('DONE'),
        failed: count('FAILED'),
        skipped: count('SKIPPED'),
        transientErrors: 0,
        ...(lastErrorCode ? { lastErrorCode } : {}),
        lockedUntil: new Date(Date.now() + TRANSLATION_LOCK_MS),
      },
    });
  }

  private async release(jobId: string): Promise<void> {
    await this.prisma.aiTranslationJob.updateMany({ where: { id: jobId, status: 'RUNNING' }, data: { lockedUntil: null } });
  }

  private async finish(jobId: string, status: Extract<TranslationJobStatus, 'COMPLETED' | 'FAILED'>, lastErrorCode: AiErrorCode | null): Promise<void> {
    await this.refreshCounters(jobId, lastErrorCode);
    // Only a running job finishes here; a cancelled one keeps its status.
    await this.prisma.aiTranslationJob.updateMany({
      where: { id: jobId, status: 'RUNNING' },
      data: { status, finishedAt: new Date(), lockedUntil: null },
    });
    const job = await this.prisma.aiTranslationJob.findUnique({ where: { id: jobId }, select: { locale: true, done: true, failed: true } });
    if (job) {
      this.i18n.invalidateLocale(job.locale);
      this.logger.log(`AI translation job ${jobId} (${job.locale}) ${status.toLowerCase()}: ${job.done} done, ${job.failed} failed`);
    }
  }

  async toDTO(job: AiTranslationJob): Promise<TranslationJobDTO> {
    const [failures, cost] = await Promise.all([
      this.prisma.aiTranslationJobItem.findMany({ where: { jobId: job.id, status: 'FAILED' }, orderBy: { key: 'asc' }, take: 50 }),
      this.prisma.aiUsage.aggregate({ where: { translationJobId: job.id }, _sum: { costMicroUsd: true } }),
    ]);
    return {
      id: job.id,
      locale: job.locale,
      status: job.status as TranslationJobStatus,
      namespaces: job.namespaces,
      overwrite: job.overwrite,
      total: job.total,
      done: job.done,
      failed: job.failed,
      skipped: job.skipped,
      model: job.model,
      lastErrorCode: isAiErrorCode(job.lastErrorCode) ? job.lastErrorCode : null,
      costMicroUsd: cost._sum.costMicroUsd ?? 0,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      finishedAt: job.finishedAt?.toISOString() ?? null,
      cancelRequested: job.cancelRequestedAt !== null,
      failures: failures.map((f) => ({ key: f.key, errorCode: (f.errorCode ?? 'AI_INVALID_OUTPUT') as TranslationJobFailureDTO['errorCode'] })),
    };
  }
}
