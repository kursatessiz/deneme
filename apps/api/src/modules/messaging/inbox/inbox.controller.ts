import { Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  AssignConversationSchema,
  ConversationListQuerySchema,
  InboxReplySchema,
  MemberChatMessageSchema,
  SavedReplySchema,
  UpdateConversationStatusSchema,
} from '@platform/shared';
import type {
  AssignConversationInput,
  ConversationListQuery,
  InboxReplyInput,
  MemberChatMessageInput,
  SavedReplyInput,
  UpdateConversationStatusInput,
} from '@platform/shared';
import { CurrentUser, Tenant } from '../../auth/decorators/current-user.decorator';
import { RequirePermission, SelfService, StudioScoped } from '../../auth/decorators/require-permission.decorator';
import type { AuthUser, TenantContext } from '../../auth/tenant-context';
import { ZodBody, ZodQuery } from '../../../common/zod-body.pipe';
import { InboxService } from './inbox.service';

/** Staff inbox (docs/MESAJLASMA.md): inbox.view to read, inbox.reply to answer, inbox.manage to assign, close and edit saved replies. */
@Controller('studios/:studioId/inbox')
@StudioScoped()
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get('conversations')
  @RequirePermission('inbox.view')
  list(@Tenant() tenant: TenantContext, @ZodQuery(ConversationListQuerySchema) query: ConversationListQuery) {
    return this.inbox.list(tenant, query);
  }

  @Get('conversations/:conversationId')
  @RequirePermission('inbox.view')
  detail(@Tenant() tenant: TenantContext, @Param('conversationId', ParseUUIDPipe) conversationId: string) {
    return this.inbox.detail(tenant, conversationId);
  }

  @Post('conversations/:conversationId/reply')
  @RequirePermission('inbox.view', 'inbox.reply')
  reply(
    @Tenant() tenant: TenantContext,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @ZodBody(InboxReplySchema) body: InboxReplyInput,
  ) {
    return this.inbox.reply(tenant, conversationId, body);
  }

  @Patch('conversations/:conversationId/assign')
  @RequirePermission('inbox.view', 'inbox.manage')
  assign(
    @Tenant() tenant: TenantContext,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @ZodBody(AssignConversationSchema) body: AssignConversationInput,
  ) {
    return this.inbox.assign(tenant, conversationId, body);
  }

  @Patch('conversations/:conversationId/status')
  @RequirePermission('inbox.view', 'inbox.manage')
  setStatus(
    @Tenant() tenant: TenantContext,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @ZodBody(UpdateConversationStatusSchema) body: UpdateConversationStatusInput,
  ) {
    return this.inbox.setStatus(tenant, conversationId, body.status);
  }

  @Get('reply-templates')
  @RequirePermission('inbox.reply')
  replyTemplates(@Tenant() tenant: TenantContext) {
    return this.inbox.replyTemplates(tenant);
  }

  @Get('saved-replies')
  @RequirePermission('inbox.view')
  listSavedReplies(@Tenant() tenant: TenantContext) {
    return this.inbox.listSavedReplies(tenant);
  }

  @Post('saved-replies')
  @RequirePermission('inbox.manage')
  createSavedReply(@Tenant() tenant: TenantContext, @ZodBody(SavedReplySchema) body: SavedReplyInput) {
    return this.inbox.createSavedReply(tenant, body);
  }

  @Patch('saved-replies/:savedReplyId')
  @RequirePermission('inbox.manage')
  updateSavedReply(
    @Tenant() tenant: TenantContext,
    @Param('savedReplyId', ParseUUIDPipe) id: string,
    @ZodBody(SavedReplySchema) body: SavedReplyInput,
  ) {
    return this.inbox.updateSavedReply(tenant, id, body);
  }

  @Delete('saved-replies/:savedReplyId')
  @RequirePermission('inbox.manage')
  deleteSavedReply(@Tenant() tenant: TenantContext, @Param('savedReplyId', ParseUUIDPipe) id: string) {
    return this.inbox.deleteSavedReply(tenant, id);
  }
}

/** A member's own chat with the studio and in-app messages (mobile app, Hesabım). */
@Controller('studios/:studioId/messaging/self')
@StudioScoped()
export class MemberMessagingController {
  constructor(private readonly inbox: InboxService) {}

  @Get('chat')
  @SelfService()
  chat(@Tenant() tenant: TenantContext) {
    return this.inbox.memberChat(tenant);
  }

  @Post('chat')
  @SelfService()
  send(@Tenant() tenant: TenantContext, @ZodBody(MemberChatMessageSchema) body: MemberChatMessageInput) {
    return this.inbox.memberSend(tenant, body.body);
  }

  @Get('in-app')
  @SelfService()
  inApp(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser) {
    return this.inbox.inAppMessages(tenant, user.id);
  }

  @Post('in-app/:messageId/read')
  @SelfService()
  markRead(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser, @Param('messageId', ParseUUIDPipe) id: string) {
    return this.inbox.markInAppRead(tenant, user.id, id);
  }
}
