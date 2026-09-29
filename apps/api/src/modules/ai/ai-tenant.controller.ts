import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { AiDraftSchema, AiSuggestReplySchema, type AiDraftInput, type AiSuggestReplyInput } from '@platform/shared';
import { RequirePermission, StudioScoped } from '../auth/decorators/require-permission.decorator';
import { CurrentUser, Tenant } from '../auth/decorators/current-user.decorator';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { ZodBody } from '../../common/zod-body.pipe';
import { AiService } from './ai.service';
import { AiUsageService } from './ai-usage.service';
import { AiWritingService } from './ai-writing.service';

/** Tenant AI helpers (G3b). Studio from the tenant guard only; billed to that studio's monthly budget. */
@Controller('studios/:studioId/ai')
@StudioScoped()
export class AiTenantController {
  constructor(
    private readonly ai: AiService,
    private readonly usage: AiUsageService,
    private readonly writing: AiWritingService,
  ) {}

  @Get('status')
  @RequirePermission('ai.use')
  async status(@Tenant() tenant: TenantContext) {
    return this.usage.tenantStatus(tenant.studioId, await this.ai.isConfigured(), new Date());
  }

  @Post('draft')
  @HttpCode(200)
  @RequirePermission('ai.use')
  draft(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @ZodBody(AiDraftSchema) body: AiDraftInput) {
    return this.writing.draft(tenant, user.id, body);
  }
}

/** Inbox reply suggestion: needs both the inbox reply right and ai.use. */
@Controller('studios/:studioId/inbox')
@StudioScoped()
export class AiInboxController {
  constructor(private readonly writing: AiWritingService) {}

  @Post('conversations/:conversationId/suggest-reply')
  @HttpCode(200)
  @RequirePermission('inbox.view', 'inbox.reply', 'ai.use')
  suggest(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @ZodBody(AiSuggestReplySchema) body: AiSuggestReplyInput,
  ) {
    return this.writing.suggestReply(tenant, user.id, conversationId, body);
  }
}
