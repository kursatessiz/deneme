import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  estimateCostMicroUsd,
  isMarketingAiTask,
  resolveModelPrice,
  type AiConnectionTestDTO,
  type AiErrorCode,
  type AiTask,
  type AiTokenUsage,
} from '@platform/shared';
import { AiSettingsService } from './ai-settings.service';
import { AiUsageService } from './ai-usage.service';
import { AiError } from './ai-errors';
import {
  AI_PROVIDER_ADAPTER,
  AiProviderError,
  EMPTY_USAGE,
  type AiCompletionResult,
  type AiProviderAdapter,
} from './providers/ai-provider';

export interface AiRunInput {
  task: AiTask;
  /** Tenant the call is billed to; null for platform jobs (translation). */
  studioId: string | null;
  userId: string | null;
  translationJobId?: string | null;
  system: string[];
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTokens: number;
  timeoutMs?: number;
}

export interface AiRunResult extends AiCompletionResult {
  costMicroUsd: number;
  /** The AiUsage row of this call. */
  usageId: string;
}

/**
 * The single entry point for model calls (docs/YAPAY_ZEKA.md): checks that a
 * key exists, enforces the tenant's monthly budget, picks the model the
 * super admin chose for the task, calls the provider adapter and meters
 * every call (success or failure) as an AiUsage row with its estimated cost.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly settings: AiSettingsService,
    private readonly usage: AiUsageService,
    @Inject(AI_PROVIDER_ADAPTER) private readonly adapter: AiProviderAdapter,
  ) {}

  async isConfigured(): Promise<boolean> {
    return (await this.settings.getActiveKey()) !== null;
  }

  async assertConfigured(): Promise<void> {
    if (!(await this.isConfigured())) throw new AiError('AI_NOT_CONFIGURED');
  }

  /** The model configured for `task`. */
  async modelFor(task: AiTask): Promise<string> {
    return (await this.settings.getModels())[task];
  }

  async run(input: AiRunInput, now = new Date()): Promise<AiRunResult> {
    const row = await this.settings.getRow();
    const key = await this.settings.getActiveKey(row);
    if (!key) throw new AiError('AI_NOT_CONFIGURED');
    if (input.studioId) {
      // The marketing studio has its own monthly cap (super admin setting), checked before every call;
      // every other task uses the tenant budget.
      if (isMarketingAiTask(input.task)) {
        await this.usage.assertWithinMarketingBudget(input.studioId, now);
        // M3d: the optional per-day cap next to the monthly one (marketing_settings.ai_daily_cap_cents).
        await this.usage.assertWithinMarketingDailyCap(input.studioId, now);
      }
      else await this.usage.assertWithinBudget(input.studioId, now);
    }

    const model = (await this.settings.getModels(row))[input.task];
    const price = resolveModelPrice(model, await this.settings.getPriceOverrides(row));
    const meter = async (usage: AiTokenUsage, success: boolean, errorCode: AiErrorCode | null): Promise<{ costMicroUsd: number; usageId: string }> => {
      const costMicroUsd = estimateCostMicroUsd(usage, price);
      const usageId = await this.usage.record({
        studioId: input.studioId,
        userId: input.userId,
        task: input.task,
        model,
        usage,
        costMicroUsd,
        success,
        errorCode,
        translationJobId: input.translationJobId ?? null,
      });
      return { costMicroUsd, usageId };
    };

    let result: AiCompletionResult;
    try {
      result = await this.adapter.complete(key.key, {
        model,
        system: input.system,
        messages: input.messages,
        maxTokens: input.maxTokens,
        timeoutMs: input.timeoutMs,
      });
    } catch (err) {
      const code: AiErrorCode = err instanceof AiProviderError ? err.code : 'AI_PROVIDER_UNAVAILABLE';
      const usage = err instanceof AiProviderError && err.usage ? err.usage : EMPTY_USAGE;
      await meter(usage, false, code);
      if (!(err instanceof AiProviderError)) {
        this.logger.error(`AI adapter failed unexpectedly: ${err instanceof Error ? err.name : 'unknown error'}`);
      }
      throw new AiError(code);
    }
    const { costMicroUsd, usageId } = await meter(result.usage, true, null);
    return { ...result, costMicroUsd, usageId };
  }

  /** "Test connection": one tiny call on the cheapest configured task, metered as platform usage. */
  async testConnection(actorUserId: string): Promise<AiConnectionTestDTO> {
    const model = await this.modelFor('REPLY_SUGGESTION');
    try {
      await this.run({
        task: 'REPLY_SUGGESTION',
        studioId: null,
        userId: actorUserId,
        system: ['You are a connectivity check. Answer with the single word OK.'],
        messages: [{ role: 'user', content: 'Ping' }],
        maxTokens: 16,
        timeoutMs: 20_000,
      });
      await this.settings.recordTest(true, null);
      return { ok: true, errorCode: null, model };
    } catch (err) {
      const code: AiErrorCode = err instanceof AiError ? err.code : 'AI_PROVIDER_UNAVAILABLE';
      if (code === 'AI_NOT_CONFIGURED') throw err;
      // A cut-off "OK" still proves the key works.
      const ok = code === 'AI_INVALID_OUTPUT';
      await this.settings.recordTest(ok, ok ? null : code);
      return { ok, errorCode: ok ? null : code, model };
    }
  }
}
