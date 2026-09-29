import Anthropic from '@anthropic-ai/sdk';
import type { AiErrorCode } from '@platform/shared';
import { AiProviderError, type AiCompletionRequest, type AiCompletionResult, type AiProviderAdapter } from './ai-provider';

/** Default per-request timeout; callers pass a shorter one for interactive calls. */
const DEFAULT_TIMEOUT_MS = 90_000;
/**
 * The SDK retries 408/409/429/5xx and connection errors with exponential
 * backoff (honouring retry-after). Timeouts are retried too, so the worst
 * wall-clock time is timeout x (retries + 1); keep both modest.
 */
const MAX_RETRIES = 2;

/**
 * Models that accept `output_config.effort`. Low effort keeps adaptive
 * thinking (on by default on the newest models) short, which is what
 * translation and short copy need and what keeps the bill down. Older
 * models reject the field, so it is only sent where it is known to work.
 */
export function supportsEffort(model: string): boolean {
  return /^claude-(opus|sonnet|fable|mythos)-(4-[6-9]|5)(\b|-|$)/.test(model);
}

/** Builds the Messages API request; exported for the unit test. */
export function buildMessageParams(request: AiCompletionRequest): Anthropic.MessageCreateParamsNonStreaming {
  const last = request.system.length - 1;
  const system: Anthropic.TextBlockParam[] = request.system.map((text, index) =>
    // One cache breakpoint after the last stable block: the instructions and
    // glossary are identical across the batches of a job, only the user turn
    // changes. Prefixes below the model's minimum cacheable length are
    // simply not cached, which costs nothing extra.
    index === last ? { type: 'text', text, cache_control: { type: 'ephemeral' } } : { type: 'text', text },
  );
  return {
    model: request.model,
    max_tokens: request.maxTokens,
    system,
    messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    ...(supportsEffort(request.model) ? { output_config: { effort: 'low' as const } } : {}),
  };
}

/** Maps SDK errors (most specific first) to the platform's error codes. */
export function classifyAnthropicError(err: unknown): AiErrorCode {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return 'AI_AUTH_FAILED';
  if (err instanceof Anthropic.RateLimitError) return 'AI_RATE_LIMITED';
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 'AI_TIMEOUT';
  if (err instanceof Anthropic.APIConnectionError) return 'AI_PROVIDER_UNAVAILABLE';
  if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.NotFoundError || err instanceof Anthropic.UnprocessableEntityError) {
    return 'AI_BAD_REQUEST';
  }
  if (err instanceof Anthropic.APIError) return 'AI_PROVIDER_UNAVAILABLE';
  return 'AI_PROVIDER_UNAVAILABLE';
}

/**
 * Anthropic Claude through the official SDK. One cached client for the
 * current key, with ambient credentials disabled so only
 * the key the platform stored is ever used, and SDK logging off so neither
 * the key nor prompts reach the logs.
 */
export class AnthropicAiAdapter implements AiProviderAdapter {
  readonly name = 'anthropic';
  /** The client for the most recently used key; a replaced key simply gets a new client. */
  private current: { apiKey: string; client: Anthropic } | null = null;

  private clientFor(apiKey: string): Anthropic {
    if (this.current?.apiKey !== apiKey) {
      this.current = {
        apiKey,
        client: new Anthropic({ apiKey, authToken: null, maxRetries: MAX_RETRIES, timeout: DEFAULT_TIMEOUT_MS, logLevel: 'off' }),
      };
    }
    return this.current.client;
  }

  async complete(apiKey: string, request: AiCompletionRequest): Promise<AiCompletionResult> {
    let message: Anthropic.Message;
    try {
      message = await this.clientFor(apiKey).messages.create(buildMessageParams(request), {
        timeout: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
    } catch (err) {
      const code = classifyAnthropicError(err);
      const status = err instanceof Anthropic.APIError && typeof err.status === 'number' ? ` (HTTP ${err.status})` : '';
      throw new AiProviderError(code, `Anthropic request failed${status}`);
    }

    const usage = {
      inputTokens: message.usage.input_tokens ?? 0,
      outputTokens: message.usage.output_tokens ?? 0,
      cacheCreationTokens: message.usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    };
    if (message.stop_reason === 'refusal') throw new AiProviderError('AI_REFUSED', 'The model declined the request', usage);
    if (message.stop_reason === 'max_tokens') throw new AiProviderError('AI_INVALID_OUTPUT', 'The answer was cut off at max_tokens', usage);

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
    return { text, model: message.model, stopReason: message.stop_reason, usage };
  }
}
