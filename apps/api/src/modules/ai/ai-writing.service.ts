import { Injectable, NotFoundException } from '@nestjs/common';
import type { AiDraftDTO, AiDraftInput, AiReplySuggestionDTO, AiSuggestReplyInput } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../auth/tenant-context';
import { AiService } from './ai.service';
import {
  COPYWRITING_SYSTEM_PROMPT,
  REPLY_SYSTEM_PROMPT,
  copywritingUserMessage,
  parseCopywritingOutput,
  parseReplyOutput,
  replyUserMessage,
} from './prompts';
import { apiError } from '../../common/api-error';

/** Messages of a conversation sent as context for a reply suggestion. */
export const REPLY_CONTEXT_MESSAGES = 10;

/**
 * Tenant features on top of AiService: drafting campaign, email, SMS and
 * page text from a brief, and suggesting the next inbox reply. Both are
 * billed to the tenant and respect its monthly budget; the result is a draft
 * a person reviews, never sent automatically.
 */
@Injectable()
export class AiWritingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  async draft(tenant: TenantContext, userId: string, input: AiDraftInput): Promise<AiDraftDTO> {
    const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: tenant.studioId }, select: { name: true } });
    const result = await this.ai.run({
      task: 'COPYWRITING',
      studioId: tenant.studioId,
      userId,
      system: [COPYWRITING_SYSTEM_PROMPT],
      messages: [
        {
          role: 'user',
          content: copywritingUserMessage({ businessName: studio.name, kind: input.kind, tone: input.tone, locale: input.locale, brief: input.brief }),
        },
      ],
      maxTokens: 2_000,
      timeoutMs: 45_000,
    });
    const parsed = parseCopywritingOutput(result.text);
    return { text: parsed.text, subject: input.kind === 'EMAIL' ? parsed.subject : null };
  }

  async suggestReply(tenant: TenantContext, userId: string, conversationId: string, input: AiSuggestReplyInput): Promise<AiReplySuggestionDTO> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, studioId: tenant.studioId },
      select: { id: true, contact: { select: { locale: true } }, studio: { select: { name: true, defaultLocale: true } } },
    });
    if (!conversation) throw new NotFoundException(apiError('apiErrors.common.conversationNotFound'));
    const recent = await this.prisma.conversationMessage.findMany({
      where: { conversationId: conversation.id, studioId: tenant.studioId },
      orderBy: { createdAt: 'desc' },
      take: REPLY_CONTEXT_MESSAGES,
      select: { direction: true, body: true },
    });
    const lines = recent
      .reverse()
      .filter((m) => m.body.trim() !== '')
      .map((m) => ({ direction: m.direction, body: m.body.slice(0, 2000) }));
    const locale = input.locale ?? conversation.contact.locale ?? conversation.studio.defaultLocale;

    const result = await this.ai.run({
      task: 'REPLY_SUGGESTION',
      studioId: tenant.studioId,
      userId,
      system: [REPLY_SYSTEM_PROMPT],
      messages: [{ role: 'user', content: replyUserMessage({ businessName: conversation.studio.name, locale, lines }) }],
      maxTokens: 600,
      timeoutMs: 30_000,
    });
    return { text: parseReplyOutput(result.text) };
  }
}
