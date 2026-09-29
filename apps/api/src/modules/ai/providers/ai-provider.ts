import type { AiErrorCode, AiTokenUsage } from '@platform/shared';

/** Nest injection token for the active AiProviderAdapter. */
export const AI_PROVIDER_ADAPTER = Symbol('AI_PROVIDER_ADAPTER');

export interface AiCompletionRequest {
  model: string;
  /**
   * Stable system prompt parts, in order. The last one carries the prompt
   * cache breakpoint, so everything here must be byte-identical across calls
   * that should share the cache (no timestamps, no per-request ids).
   */
  system: string[];
  /** The volatile part: one user turn (plus optional earlier turns). */
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTokens: number;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
}

export interface AiCompletionResult {
  text: string;
  /** The model that actually served the call, as reported by the provider. */
  model: string;
  stopReason: string | null;
  usage: AiTokenUsage;
}

/**
 * A language model provider. The only adapter today is Anthropic Claude
 * (AnthropicAiAdapter); FakeAiAdapter is the deterministic stand-in for
 * tests. Adapters never log the key or prompt contents.
 */
export interface AiProviderAdapter {
  readonly name: string;
  complete(apiKey: string, request: AiCompletionRequest): Promise<AiCompletionResult>;
}

/** A provider failure, already classified. Thrown by adapters, mapped to HTTP by AiError. */
export class AiProviderError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    /** Usage the provider billed before failing (e.g. a refusal), if known. */
    readonly usage: AiTokenUsage | null = null,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

export const EMPTY_USAGE: AiTokenUsage = Object.freeze({ inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 });
