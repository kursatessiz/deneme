import { BadRequestException, Controller, Headers, HttpCode, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  PUBLIC_IDEMPOTENCY_HEADER,
  PublicAddTagsSchema,
  PublicIdempotencyKeySchema,
  PublicRecordConsentSchema,
  PublicUpsertContactSchema,
} from '@platform/shared';
import type { PublicAddTagsInput, PublicRecordConsentInput, PublicUpsertContactInput } from '@platform/shared';
import { PublicApiScoped } from '../api-keys/require-scope.decorator';
import { ApiKeyTenant } from '../api-keys/api-key-tenant.decorator';
import type { ApiKeyTenantContext } from '../api-keys/api-key-tenant-context';
import { ZodBody } from '../../common/zod-body.pipe';
import { PublicContactsService } from './contacts-public.service';
import { PublicIdempotencyService } from './idempotency.service';
import { hashPublicRequest } from './idempotency.util';
import { apiError } from '../../common/api-error';

function idempotencyKeyOf(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const parsed = PublicIdempotencyKeySchema.safeParse(header);
  if (!parsed.success) throw new BadRequestException(apiError('apiErrors.publicApi.invalidIdempotencyKey'));
  return parsed.data;
}

/**
 * Inbound actions for automation tools such as Zapier, Make and n8n (M4c,
 * docs/PUBLIC_API.md, docs/ZAPIER.md). API key auth with the crm.write
 * scope and the same per-key rate limit as every /v1/public/* endpoint.
 * Creating a contact accepts an Idempotency-Key header (kept 24 hours).
 */
@ApiTags('Public API')
@Controller('v1/public/contacts')
export class ContactsPublicController {
  constructor(
    private readonly contacts: PublicContactsService,
    private readonly idempotency: PublicIdempotencyService,
  ) {}

  /** Creates the contact, or updates the one that already has this phone or e-mail (201 when created, 200 when updated). */
  @Post()
  @PublicApiScoped('crm.write')
  async upsert(
    @ApiKeyTenant() tenant: ApiKeyTenantContext,
    @Headers(PUBLIC_IDEMPOTENCY_HEADER) idempotencyKey: string | undefined,
    @ZodBody(PublicUpsertContactSchema) body: PublicUpsertContactInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const key = idempotencyKeyOf(idempotencyKey);
    const result = await this.idempotency.run(tenant.studioId, tenant.apiKeyId, key, hashPublicRequest('POST', req.path, body), async () => {
      const outcome = await this.contacts.upsert(tenant.studioId, tenant.apiKeyId, body);
      return { status: outcome.created ? 201 : 200, body: outcome };
    });
    res.status(result.status);
    if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return result.body;
  }

  @Post(':id/tags')
  @HttpCode(200)
  @PublicApiScoped('crm.write')
  async addTags(@ApiKeyTenant() tenant: ApiKeyTenantContext, @Param('id', ParseUUIDPipe) id: string, @ZodBody(PublicAddTagsSchema) body: PublicAddTagsInput) {
    return this.contacts.addTags(tenant.studioId, tenant.apiKeyId, id, body);
  }

  @Post(':id/consents')
  @HttpCode(200)
  @PublicApiScoped('crm.write')
  async recordConsent(
    @ApiKeyTenant() tenant: ApiKeyTenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(PublicRecordConsentSchema) body: PublicRecordConsentInput,
  ) {
    return this.contacts.recordConsent(tenant.studioId, tenant.apiKeyId, id, body);
  }
}
