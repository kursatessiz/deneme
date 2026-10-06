import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@platform/database';
import {
  MarketingBriefSchema,
  countOrNull,
  runMarketingChecks,
  type AddVariantsInput,
  type GenerateDraftsInput,
  type GenerateDraftsResultDTO,
  type GeneratableDraftKind,
  type MarketingCheckContext,
  type MarketingAiStatusDTO,
  type MarketingDraftDTO,
  type MarketingDraftKind,
  type ResearchRequestInput,
  type SegmentInsightDTO,
  type SegmentSuggestionResultDTO,
  type SuggestSegmentsInput,
} from '@platform/shared';
import type { PlatformContext } from '../../auth/tenant-context';
import { AiService } from '../../ai/ai.service';
import { AiUsageService } from '../../ai/ai-usage.service';
import { AiError } from '../../ai/ai-errors';
import { AiProviderError } from '../../ai/providers/ai-provider';
import {
  MARKETING_ANALYSIS_SYSTEM_PROMPT,
  MARKETING_DRAFT_SYSTEM_PROMPT,
  MARKETING_RESEARCH_SYSTEM_PROMPT,
  analysisUserMessage,
  brandKitBlock,
  draftUserMessage,
  parseAnalysisOutput,
  parseDraftOutput,
  parseResearchOutput,
  redactedBrief,
  researchUserMessage,
  type ResearchSourcePrompt,
} from '../../ai/marketing-prompts';
import { SegmentEvaluatorService } from '../../growth/segments/segment-evaluator.service';
import { BrandKitService } from './brand-kit.service';
import { MarketingDraftsService, type NewVariant } from './marketing-drafts.service';
import { SegmentInsightService } from './segment-insight.service';
import { codedError } from '../../../common/api-error';

/** Errors that make every further call pointless: the whole request stops. */
const FATAL_CODES: ReadonlySet<string> = new Set(['MARKETING_AI_BUDGET_EXCEEDED', 'AI_MONTHLY_LIMIT_REACHED', 'AI_NOT_CONFIGURED', 'AI_AUTH_FAILED']);

function toAiError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  if (err instanceof AiProviderError) return new AiError(err.code);
  throw err;
}

/**
 * The AI studio (M2b/M2d, docs/PAZARLAMA_MODULU.md 4.3): brief to per
 * channel drafts with N variants, more variants for a draft, segment
 * suggestions from k-anonymous aggregates, and cited research notes.
 * Everything goes through AiService.run() on the platform tenant (so the
 * marketing budget is enforced before every call and every call is metered)
 * and everything lands as a DRAFT the user edits. Nothing is sent or
 * published, and no personal data is put into a prompt.
 *
 * Research mode: the AI core has no search or fetch capability, so the
 * studio implements "cited notes": the user pastes sources, the model
 * answers only from them, and every point must quote its source verbatim
 * (verified server side; points without a verifiable citation are dropped).
 */
@Injectable()
export class MarketingAiService {
  private readonly logger = new Logger(MarketingAiService.name);

  constructor(
    private readonly ai: AiService,
    private readonly usage: AiUsageService,
    private readonly brandKit: BrandKitService,
    private readonly drafts: MarketingDraftsService,
    private readonly insight: SegmentInsightService,
    private readonly evaluator: SegmentEvaluatorService,
  ) {}

  async status(platform: PlatformContext): Promise<MarketingAiStatusDTO> {
    return this.usage.marketingStatus(platform.platformStudioId, await this.ai.isConfigured(), new Date());
  }

  async segmentInsight(platform: PlatformContext): Promise<SegmentInsightDTO> {
    return this.insight.compute(platform.platformStudioId);
  }

  async generate(platform: PlatformContext, input: GenerateDraftsInput): Promise<GenerateDraftsResultDTO> {
    const context = await this.brandKit.requireContext(platform.platformStudioId);
    const icp = input.brief.icpKey ? (context.kit.icps.find((i) => i.key === input.brief.icpKey) ?? null) : null;
    const brief = redactedBrief(input.brief);
    const created: MarketingDraftDTO[] = [];
    const failures: GenerateDraftsResultDTO['failures'] = [];

    for (const locale of input.locales) {
      const { input: brandInput, facts } = this.brandKit.promptInput(context, locale);
      const block = brandKitBlock(brandInput);
      for (const kind of input.kinds) {
        try {
          const generated = await this.generateVariants(platform, { kind, locale, count: input.variantCount, brief: input.brief, block, factKeys: facts.map((f) => f.key), icp, check: this.brandKit.checkContext(context.kit, locale, kind) });
          created.push(
            await this.drafts.create(platform, {
              kind,
              locale,
              title: brief.goal,
              brief: brief as unknown as Prisma.InputJsonValue,
              factKeys: generated.factKeys,
              brandKitVersion: context.kit.version,
              model: generated.model,
              costMicroUsd: generated.costMicroUsd,
              variants: generated.variants,
            }),
          );
        } catch (err) {
          const aiError = toAiError(err);
          if (FATAL_CODES.has(aiError.code)) throw aiError;
          this.logger.warn(`Marketing draft generation failed (${kind}/${locale}): ${aiError.code}`);
          failures.push({ kind, locale, code: aiError.code });
        }
      }
    }
    const first = failures[0];
    if (created.length === 0 && first) throw new AiError(first.code as AiError['code']);
    return { drafts: created, failures };
  }

  /** N more variants for an existing generated draft, from its stored brief. */
  async addVariants(platform: PlatformContext, draftId: string, input: AddVariantsInput): Promise<MarketingDraftDTO> {
    const draft = await this.drafts.load(platform, draftId);
    const kind = draft.kind as MarketingDraftKind;
    const brief = MarketingBriefSchema.safeParse(draft.brief);
    if (!brief.success || kind === 'SEGMENT_SUGGESTION' || kind === 'RESEARCH_NOTE') {
      throw new BadRequestException(codedError('DRAFT_KIND_NOT_EDITABLE', { statusCode: 400 }));
    }
    if (draft.status === 'ARCHIVED') throw new ConflictException(codedError('DRAFT_ARCHIVED', { statusCode: 409 }));
    const context = await this.brandKit.requireContext(platform.platformStudioId);
    const { input: brandInput, facts } = this.brandKit.promptInput(context, draft.locale);
    const icp = brief.data.icpKey ? (context.kit.icps.find((i) => i.key === brief.data.icpKey) ?? null) : null;
    try {
      const generated = await this.generateVariants(platform, {
        kind: kind as GeneratableDraftKind,
        locale: draft.locale,
        count: input.count,
        brief: brief.data,
        block: brandKitBlock(brandInput),
        factKeys: facts.map((f) => f.key),
        icp,
        check: this.brandKit.checkContext(context.kit, draft.locale, kind),
      });
      return await this.drafts.appendVariants(platform, draftId, generated.variants, generated.costMicroUsd);
    } catch (err) {
      throw toAiError(err);
    }
  }

  async suggestSegments(platform: PlatformContext, input: SuggestSegmentsInput): Promise<SegmentSuggestionResultDTO> {
    const studioId = platform.platformStudioId;
    const context = await this.brandKit.requireContext(studioId);
    const insight = await this.insight.compute(studioId);
    if (insight.totalContacts === null) {
      throw new ConflictException(codedError('SEGMENT_DATA_TOO_SMALL', { statusCode: 409 }));
    }
    const locale = input.locale ?? context.kit.defaultLocale;
    let result;
    try {
      result = await this.ai.run({
        task: 'MARKETING_ANALYSIS',
        studioId,
        userId: platform.userId,
        system: [MARKETING_ANALYSIS_SYSTEM_PROMPT],
        messages: [{ role: 'user', content: analysisUserMessage({ goal: input.goal, locale, count: input.count, insight }) }],
        maxTokens: 2_000,
        timeoutMs: 60_000,
      });
    } catch (err) {
      throw toAiError(err);
    }

    const variants: NewVariant[] = [];
    try {
      const suggestions = parseAnalysisOutput(result.text, input.count);
      const now = new Date();
      const ctx = { locale, bannedPhrases: this.brandKit.localeRowFor(context.kit, locale)?.bannedPhrases ?? [], requiredDisclaimer: null };
      for (const s of suggestions) {
        try {
          // The rule language is enforced server side: anything the model invents is rejected.
          const rules = await this.evaluator.validate(studioId, s.rules);
          const count = await this.insight.countMatching(studioId, await this.evaluator.where(studioId, rules, now));
          const content = { name: s.name, rationale: s.rationale, rules, approxCount: countOrNull(count) };
          variants.push({ content, issues: runMarketingChecks('SEGMENT_SUGGESTION', content, ctx) });
        } catch (err) {
          if (!(err instanceof BadRequestException)) throw err;
          this.logger.warn('A suggested segment rule was rejected by the rule language');
        }
      }
    } catch (err) {
      throw toAiError(err);
    }
    if (variants.length === 0) throw new AiError('AI_INVALID_OUTPUT');

    const draft = await this.drafts.create(platform, {
      kind: 'SEGMENT_SUGGESTION',
      locale,
      title: input.goal,
      brief: { goal: input.goal } as Prisma.InputJsonValue,
      factKeys: [],
      brandKitVersion: context.kit.version,
      model: result.model,
      costMicroUsd: result.costMicroUsd,
      variants,
    });
    return { draft, insight };
  }

  /** Cited notes: answers from the pasted sources only; see the class comment. */
  async research(platform: PlatformContext, input: ResearchRequestInput): Promise<MarketingDraftDTO> {
    const studioId = platform.platformStudioId;
    const context = await this.brandKit.requireContext(studioId);
    const locale = input.locale ?? context.kit.defaultLocale;
    const sources: ResearchSourcePrompt[] = input.sources.map((s, index) => ({ id: `S${index + 1}`, title: s.title, url: s.url ?? null, text: s.text }));
    let result;
    try {
      result = await this.ai.run({
        task: 'MARKETING_RESEARCH',
        studioId,
        userId: platform.userId,
        system: [MARKETING_RESEARCH_SYSTEM_PROMPT],
        messages: [{ role: 'user', content: researchUserMessage({ question: input.question, locale, sources }) }],
        maxTokens: 2_500,
        timeoutMs: 60_000,
      });
    } catch (err) {
      throw toAiError(err);
    }
    let parsed;
    try {
      parsed = parseResearchOutput(result.text, sources);
    } catch (err) {
      throw toAiError(err);
    }
    const content = {
      question: input.question,
      summary: parsed.summary,
      points: parsed.points,
      sources: sources.map((s) => ({ id: s.id, title: s.title, url: s.url })),
      mode: 'CITED_NOTES' as const,
    };
    const ctx = { locale, bannedPhrases: this.brandKit.localeRowFor(context.kit, locale)?.bannedPhrases ?? [], requiredDisclaimer: null };
    return this.drafts.create(platform, {
      kind: 'RESEARCH_NOTE',
      locale,
      title: input.question,
      brief: null,
      factKeys: [],
      brandKitVersion: context.kit.version,
      model: result.model,
      costMicroUsd: result.costMicroUsd,
      variants: [{ content, issues: runMarketingChecks('RESEARCH_NOTE', content, ctx) }],
    });
  }

  private async generateVariants(
    platform: PlatformContext,
    args: {
      kind: GeneratableDraftKind;
      locale: string;
      count: number;
      brief: GenerateDraftsInput['brief'];
      block: string;
      factKeys: string[];
      icp: Parameters<typeof draftUserMessage>[0]['icp'];
      check: MarketingCheckContext;
    },
  ): Promise<{ variants: NewVariant[]; factKeys: string[]; model: string; costMicroUsd: number }> {
    const ctx = args.check;
    const result = await this.ai.run({
      task: 'MARKETING_DRAFT',
      studioId: platform.platformStudioId,
      userId: platform.userId,
      system: [MARKETING_DRAFT_SYSTEM_PROMPT, args.block],
      messages: [
        {
          role: 'user',
          content: draftUserMessage({ kind: args.kind, locale: args.locale, variantCount: args.count, brief: args.brief, icp: args.icp, requiredDisclaimer: ctx.requiredDisclaimer ?? null }),
        },
      ],
      maxTokens: 3_000,
      timeoutMs: 60_000,
    });
    const parsed = parseDraftOutput(result.text, args.kind, args.factKeys, args.count);
    return {
      variants: parsed.variants.map((content) => ({ content, issues: runMarketingChecks(args.kind, content, ctx) })),
      factKeys: parsed.factKeys,
      model: result.model,
      costMicroUsd: result.costMicroUsd,
    };
  }
}
