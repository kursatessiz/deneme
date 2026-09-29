import Anthropic from '@anthropic-ai/sdk';
import { buildMessageParams, classifyAnthropicError, supportsEffort } from './anthropic.adapter';

describe('AnthropicAiAdapter request building', () => {
  const request = {
    model: 'claude-sonnet-5',
    system: ['rules', 'glossary'],
    messages: [{ role: 'user' as const, content: 'items' }],
    maxTokens: 1000,
  };

  it('puts one prompt cache breakpoint on the last stable system block', () => {
    const params = buildMessageParams(request);
    expect(params.system).toEqual([
      { type: 'text', text: 'rules' },
      { type: 'text', text: 'glossary', cache_control: { type: 'ephemeral' } },
    ]);
    expect(params.messages).toEqual([{ role: 'user', content: 'items' }]);
    expect(params.max_tokens).toBe(1000);
  });

  it('asks for low effort only on models that accept it', () => {
    expect(buildMessageParams(request).output_config).toEqual({ effort: 'low' });
    expect(buildMessageParams({ ...request, model: 'claude-haiku-4-5-20251001' }).output_config).toBeUndefined();
    expect(supportsEffort('claude-opus-5-5')).toBe(true);
    expect(supportsEffort('claude-sonnet-4-6')).toBe(true);
    expect(supportsEffort('claude-sonnet-4-5')).toBe(false);
    expect(supportsEffort('claude-haiku-4-5')).toBe(false);
  });
});

describe('classifyAnthropicError', () => {
  const headers = new Headers();

  it('maps SDK errors to platform error codes, most specific first', () => {
    expect(classifyAnthropicError(new Anthropic.AuthenticationError(401, {}, 'no', headers))).toBe('AI_AUTH_FAILED');
    expect(classifyAnthropicError(new Anthropic.PermissionDeniedError(403, {}, 'no', headers))).toBe('AI_AUTH_FAILED');
    expect(classifyAnthropicError(new Anthropic.RateLimitError(429, {}, 'slow down', headers))).toBe('AI_RATE_LIMITED');
    expect(classifyAnthropicError(new Anthropic.BadRequestError(400, {}, 'bad', headers))).toBe('AI_BAD_REQUEST');
    expect(classifyAnthropicError(new Anthropic.NotFoundError(404, {}, 'model', headers))).toBe('AI_BAD_REQUEST');
    expect(classifyAnthropicError(new Anthropic.InternalServerError(529, {}, 'overloaded', headers))).toBe('AI_PROVIDER_UNAVAILABLE');
    expect(classifyAnthropicError(new Anthropic.APIConnectionTimeoutError({ message: 'timeout' }))).toBe('AI_TIMEOUT');
    expect(classifyAnthropicError(new Anthropic.APIConnectionError({ message: 'reset' }))).toBe('AI_PROVIDER_UNAVAILABLE');
    expect(classifyAnthropicError(new Error('unknown'))).toBe('AI_PROVIDER_UNAVAILABLE');
  });
});
