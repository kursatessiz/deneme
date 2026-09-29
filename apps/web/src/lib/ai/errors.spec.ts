import { BASE_MESSAGES, createTranslator } from '@platform/shared';
import { BffError } from '@/lib/session/client';
import { aiErrorText } from './errors';

const t = createTranslator({ locale: 'tr', messages: BASE_MESSAGES, fallback: BASE_MESSAGES });

describe('aiErrorText', () => {
  it('translates the API error code', () => {
    expect(aiErrorText(new BffError('x', 503, 'AI_NOT_CONFIGURED'), t)).toBe(BASE_MESSAGES['ai.error.AI_NOT_CONFIGURED']);
    expect(aiErrorText(new BffError('x', 429, 'AI_MONTHLY_LIMIT_REACHED'), t)).toBe(BASE_MESSAGES['ai.error.AI_MONTHLY_LIMIT_REACHED']);
  });

  it('falls back to the API message, then a generic text', () => {
    expect(aiErrorText(new BffError('Geçersiz istek', 400), t)).toBe('Geçersiz istek');
    expect(aiErrorText(new Error('boom'), t)).toBe(BASE_MESSAGES['ai.error.generic']);
  });
});
