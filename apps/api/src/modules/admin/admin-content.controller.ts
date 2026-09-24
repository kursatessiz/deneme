import { Controller, Get, Post, Query } from '@nestjs/common';
import { AdminUpsertMessageTemplateSchema, PublishDocumentVersionSchema } from '@platform/shared';
import type { AdminUpsertMessageTemplateInput, PublishDocumentVersionInput } from '@platform/shared';
import { SuperAdminOnly } from '../auth/decorators/super-admin-only.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/tenant-context';
import { ZodBody } from '../../common/zod-body.pipe';
import { AdminContentService } from './admin-content.service';

/** Global message templates and document versions (backlog 4.3). Passing no
 * `studioId` query param lists every template/document across tenants; the
 * upsert/publish body's `studioId` (null by default) decides whether the
 * write targets the global default or one tenant's override. */
@Controller('admin/content')
@SuperAdminOnly()
export class AdminContentController {
  constructor(private readonly content: AdminContentService) {}

  @Get('message-templates')
  async listMessageTemplates(@Query('studioId') studioId?: string) {
    return { items: await this.content.listMessageTemplates(studioId) };
  }

  @Post('message-templates')
  async upsertMessageTemplate(
    @CurrentUser() user: AuthUser,
    @ZodBody(AdminUpsertMessageTemplateSchema) body: AdminUpsertMessageTemplateInput,
  ) {
    return this.content.upsertMessageTemplate(user.id, body);
  }

  @Get('document-versions')
  async listDocumentVersions(@Query('studioId') studioId?: string) {
    return { items: await this.content.listDocumentVersions(studioId) };
  }

  @Post('document-versions')
  async publishDocumentVersion(
    @CurrentUser() user: AuthUser,
    @ZodBody(PublishDocumentVersionSchema) body: PublishDocumentVersionInput,
  ) {
    return this.content.publishDocumentVersion(user.id, body);
  }
}
