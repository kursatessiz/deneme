import type { AiErrorCode, AiTokenUsage, PluralCategory } from '@platform/shared';
import { TRANSLATION_ITEMS_CLOSE, TRANSLATION_ITEMS_OPEN, type TranslationRequestItem } from '../prompts';
import { MARKETING_REQUEST_CLOSE, MARKETING_REQUEST_OPEN } from '../marketing-prompts';
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
  /** Text appended to the main text of the first marketing variant (to exercise the brand checks). */
  marketingAppend = '';
  /** Segment suggestions also include one rule the segment language rejects. */
  includeInvalidSegment = false;
  /** Research answers also include a point whose quote is not in any source. */
  researchBadQuote = false;
  /** Usage reported for every successful call. */
  usage: AiTokenUsage = { inputTokens: 1200, outputTokens: 300, cacheCreationTokens: 0, cacheReadTokens: 800 };

  reset(): void {
    this.requests.length = 0;
    this.dropPlaceholdersFor.clear();
    this.omit.clear();
    this.failNext.length = 0;
    this.marketingAppend = '';
    this.includeInvalidSegment = false;
    this.researchBadQuote = false;
  }

  async complete(apiKey: string, request: AiCompletionRequest): Promise<AiCompletionResult> {
    this.requests.push(request);
    if (apiKey.includes(FAKE_INVALID_KEY_MARKER)) throw new AiProviderError('AI_AUTH_FAILED', 'Fake provider rejected the key');
    const failure = this.failNext.shift();
    if (failure) throw new AiProviderError(failure, `Fake provider failure ${failure}`);

    const user = request.messages[request.messages.length - 1]?.content ?? '';
    const text = user.includes(MARKETING_REQUEST_OPEN)
      ? this.marketing(user)
      : user.includes(TRANSLATION_ITEMS_OPEN)
        ? this.translate(request, user)
        : this.write(user);
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

  /** Deterministic answers for the marketing studio; every field honours the limits and the disclaimer in the request. */
  private marketing(user: string): string {
    const start = user.indexOf(MARKETING_REQUEST_OPEN) + MARKETING_REQUEST_OPEN.length;
    const end = user.indexOf(MARKETING_REQUEST_CLOSE);
    const req = JSON.parse(user.slice(start, end)) as {
      task: string;
      kind?: string;
      variants?: number;
      suggestions?: number;
      requiredDisclaimer?: string;
      sources?: Array<{ id: string; text: string }>;
      metrics?: Array<{ key: string; current: number | null; previous: number | null }>;
    };
    if (req.task === 'MARKETING_ANALYSIS') return this.segments(req.suggestions ?? 2);
    if (req.task === 'MARKETING_RESEARCH') return this.research(req.sources ?? []);
    if (req.task === 'MARKETING_WEEKLY_SUMMARY') return this.weeklySummary(req.metrics ?? []);
    const n = req.variants ?? 1;
    const disclaimer = req.requiredDisclaimer ? ` ${req.requiredDisclaimer}` : '';
    const variants = Array.from({ length: n }, (_, i) => this.variant(req.kind ?? 'EMAIL', i, disclaimer, i === 0 ? this.marketingAppend : ''));
    return JSON.stringify({ variants, factKeys: ['platform.multi_tenant', 'unknown.key'] });
  }

  private variant(kind: string, i: number, disclaimer: string, extra: string): Record<string, unknown> {
    const tail = extra ? ` ${extra}` : '';
    switch (kind) {
      case 'EMAIL':
        return { subject: `Online booking, variant ${i + 1}`, preheader: 'Set up in an afternoon', body: `Hello {firstName}, manage sessions in one place.${tail}${disclaimer}` };
      case 'SMS':
        return { text: `Hi {firstName}, try online booking today.${tail}${disclaimer}` };
      case 'WHATSAPP':
        return { templateName: `booking_intro_${i + 1}`, category: 'MARKETING', body: `Hello {firstName}, we help studios take bookings online.${tail}${disclaimer}` };
      case 'AD_META':
        return { primaryText: `Run your studio from one screen.${tail}`, headline: `Online booking ${i + 1}`, description: 'Try it' };
      case 'AD_GOOGLE_RSA':
        return {
          headlines: ['Studio booking software', 'Manage sessions online', 'Memberships made simple'],
          descriptions: [`Bookings, packages and reminders in one place.${tail}`, 'Start with a free trial.'],
        };
      case 'AD_LINKEDIN':
        return { introText: `Owners save hours every week.${tail}`, headline: `One platform ${i + 1}`, description: 'See how it works' };
      case 'LANDING_BLOCK':
        return { heading: `Fill your classes ${i + 1}`, subheading: `Bookings and packages in one place.${tail}`, bullets: ['Online booking', 'Automatic reminders'], ctaLabel: 'Start free' };
      case 'SUBJECT_LINES':
        return { subject: `Fill your calendar ${i + 1}${tail}`, preheader: 'A quick look' };
      case 'CTA_VARIANTS':
        return { label: `Start free ${i + 1}${tail}` };
      case 'SEO_OUTLINE':
        return {
          title: `Studio software ${i + 1}`,
          metaDescription: `Software for studios.${tail}`,
          headings: [
            { level: 2, text: 'What it does' },
            { level: 3, text: 'Bookings' },
          ],
          faq: [{ question: 'Is there a trial?', answer: 'Yes.' }],
          internalLinkIdeas: ['pricing'],
        };
      default:
        return { text: 'ok' };
    }
  }

  private segments(count: number): string {
    const suggestions: Array<Record<string, unknown>> = [
      {
        name: 'Open leads',
        rationale: 'Leads that have not converted yet.',
        rules: { combinator: 'and', rules: [{ field: 'contact.lifecycleStage', op: 'in', value: ['LEAD'] }] },
      },
      {
        name: 'Recent contacts',
        rationale: 'Contacts created in the last 90 days.',
        rules: { combinator: 'and', rules: [{ field: 'contact.createdAt', op: 'in_last_days', value: 90 }] },
      },
    ];
    if (this.includeInvalidSegment) {
      suggestions.unshift({
        name: 'Made up',
        rationale: 'Uses a field that does not exist.',
        rules: { combinator: 'and', rules: [{ field: 'contact.shoeSize', op: 'eq', value: 42 }] },
      });
    }
    return JSON.stringify({ suggestions: suggestions.slice(0, Math.max(count, this.includeInvalidSegment ? 3 : 1)) });
  }

  /** Three actions on the first metrics that have a visible value (or any key), so every answer is grounded in the request. */
  private weeklySummary(metrics: Array<{ key: string; current: number | null; previous: number | null }>): string {
    const visible = metrics.filter((m) => m.current !== null || m.previous !== null);
    const keys = (visible.length >= 3 ? visible : metrics).slice(0, 3).map((m) => m.key);
    while (keys.length < 3) keys.push(keys[0] ?? 'leads');
    const first = visible[0];
    const summary = first ? `The week is summarised from ${visible.length} visible figures; ${first.key} is ${first.current ?? 'hidden'} against ${first.previous ?? 'hidden'} the week before.` : 'There is not enough visible data to summarise this week.';
    return JSON.stringify({
      summary,
      actions: keys.map((kpiKey, i) => ({ title: `Review ${kpiKey}`, detail: `Look at what drove ${kpiKey} this week and decide the next step ${i + 1}.`, kpiKey })),
    });
  }

  private research(sources: Array<{ id: string; text: string }>): string {
    const points = sources.map((s) => ({ claim: `From ${s.id}`, sourceId: s.id, quote: s.text.split(/[.!?]/)[0].trim().slice(0, 120) }));
    if (this.researchBadQuote) points.push({ claim: 'Invented', sourceId: sources[0]?.id ?? 'S1', quote: 'This sentence is not in any source' });
    return JSON.stringify({ summary: 'Summary of the pasted sources.', points });
  }
}
