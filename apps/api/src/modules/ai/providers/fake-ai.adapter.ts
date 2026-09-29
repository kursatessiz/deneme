import type { AiErrorCode, AiTokenUsage, PluralCategory } from '@platform/shared';
import { TRANSLATION_ITEMS_CLOSE, TRANSLATION_ITEMS_OPEN, type TranslationRequestItem } from '../prompts';
import { AiProviderError, type AiCompletionRequest, type AiCompletionResult, type AiProviderAdapter } from './ai-provider';

/** A key containing this marker fails authentication in the fake provider. */
export const FAKE_INVALID_KEY_MARKER = 'invalid';

/**
 * Deterministic stand-in for the provider, used by the unit tests, the API
 * e2e suite (injected with overrideProvider) and the web e2e stack
 * (AI_FAKE_PROVIDER=1, refused at boot in production). It never touches the
 * network. Translations are "<code>: <source>" so placeholders survive;
 * tests can make chosen keys drop their placeholders or queue errors.
 */
export class FakeAiAdapter implements AiProviderAdapter {
  readonly name = 'fake';
  /** Every request, for assertions. */
  readonly requests: AiCompletionRequest[] = [];
  /** Item ids whose translation loses its placeholders (to exercise validation). */
  readonly dropPlaceholdersFor = new Set<string>();
  /** Item ids left out of the answer. */
  readonly omit = new Set<string>();
  /** Errors thrown by the next calls, in order. */
  readonly failNext: AiErrorCode[] = [];
  /** Usage reported for every successful call. */
  usage: AiTokenUsage = { inputTokens: 1200, outputTokens: 300, cacheCreationTokens: 0, cacheReadTokens: 800 };

  reset(): void {
    this.requests.length = 0;
    this.dropPlaceholdersFor.clear();
    this.omit.clear();
    this.failNext.length = 0;
  }

  async complete(apiKey: string, request: AiCompletionRequest): Promise<AiCompletionResult> {
    this.requests.push(request);
    if (apiKey.includes(FAKE_INVALID_KEY_MARKER)) throw new AiProviderError('AI_AUTH_FAILED', 'Fake provider rejected the key');
    const failure = this.failNext.shift();
    if (failure) throw new AiProviderError(failure, `Fake provider failure ${failure}`);

    const user = request.messages[request.messages.length - 1]?.content ?? '';
    const text = user.includes(TRANSLATION_ITEMS_OPEN) ? this.translate(request, user) : this.write(user);
    return { text, model: request.model, stopReason: 'end_turn', usage: { ...this.usage } };
  }

  private translate(request: AiCompletionRequest, user: string): string {
    const start = user.indexOf(TRANSLATION_ITEMS_OPEN) + TRANSLATION_ITEMS_OPEN.length;
    const end = user.indexOf(TRANSLATION_ITEMS_CLOSE);
    const items = JSON.parse(user.slice(start, end)) as TranslationRequestItem[];
    const code = /locale code ([a-zA-Z-]+)/.exec(request.system.join('\n'))?.[1] ?? 'xx';
    const render = (id: string, source: string): string => {
      const text = `${code}: ${source}`;
      return this.dropPlaceholdersFor.has(id) ? text.replace(/\{[a-zA-Z0-9_]+\}/g, 'X') : text;
    };
    const translations = items
      .filter((item) => !this.omit.has(item.id))
      .map((item) => {
        if (item.categories && item.forms) {
          const forms: Partial<Record<PluralCategory, string>> = {};
          for (const category of item.categories) forms[category] = render(item.id, item.forms[category] ?? item.forms.other ?? '');
          return { id: item.id, forms };
        }
        return { id: item.id, value: render(item.id, item.source ?? '') };
      });
    return JSON.stringify({ translations });
  }

  private write(user: string): string {
    if (user.includes('<conversation>')) return 'Mesajiniz icin tesekkurler, hemen kontrol edip size donecegiz.';
    let kind = 'CAMPAIGN';
    try {
      kind = (JSON.parse(user) as { kind?: string }).kind ?? kind;
    } catch {
      // Not a copywriting request; answer with plain text.
    }
    return JSON.stringify({ subject: kind === 'EMAIL' ? 'Yeni donem basliyor' : '', text: 'Yeni donem basliyor. Yerinizi simdiden ayirtin.' });
  }
}
