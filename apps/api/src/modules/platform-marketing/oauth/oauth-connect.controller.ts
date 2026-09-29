import { BadRequestException, Controller, Delete, Get, Headers, HttpCode, Param, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  INTEGRATION_ENTRY_HEADER,
  OAuthCallbackQuerySchema,
  OAuthProviderSlugSchema,
  SetOAuthClientSchema,
  StartOAuthSchema,
  oauthProviderFromSlug,
  type OAuthProvider,
  type SetOAuthClientInput,
  type StartOAuthInput,
} from '@platform/shared';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Platform, PlatformScoped, RequirePlatformPermission } from '../../auth/decorators/platform-scoped.decorator';
import { SuperAdminOnly } from '../../auth/decorators/super-admin-only.decorator';
import type { AuthUser, PlatformContext } from '../../auth/tenant-context';
import { ZodBody, ZodValidationPipe } from '../../../common/zod-body.pipe';
import { OAuthClientSettingsService } from './oauth-client-settings.service';
import { OAuthConnectService } from './oauth-connect.service';
import { OAuthCallbackRateLimitGuard, OAuthStartRateLimitGuard } from './oauth-rate-limit.guard';

const ProviderParam = new ZodValidationPipe(OAuthProviderSlugSchema);

function providerOf(slug: string): OAuthProvider {
  const provider = oauthProviderFromSlug(slug);
  if (!provider) throw new BadRequestException('Bilinmeyen sağlayıcı');
  return provider;
}

/**
 * Starts an OAuth authorization from the integrations hub (M4a). Behind the
 * JWT and platform permission guards like every hub write, and behind the
 * web BFF's CSRF check like every other POST.
 */
@Controller('platform/integrations/oauth')
@PlatformScoped()
@RequirePlatformPermission('platform.integrations.manage')
export class OAuthConnectController {
  constructor(private readonly oauth: OAuthConnectService) {}

  @Post(':provider/start')
  @HttpCode(200)
  @UseGuards(OAuthStartRateLimitGuard)
  start(
    @Platform() platform: PlatformContext,
    @Headers(INTEGRATION_ENTRY_HEADER) via: string | undefined,
    @Param('provider', ProviderParam) slug: string,
    @ZodBody(StartOAuthSchema) body: StartOAuthInput,
  ) {
    return this.oauth.start(platform, platform.isSuperAdmin && via === 'admin' ? 'admin' : 'marketing', providerOf(slug), body);
  }
}

/**
 * The provider's redirect back (M4a). Public by nature: no JWT, the one-time
 * state is the credential. Rate limited per IP; the response is always a
 * redirect to a fixed hub path on PUBLIC_APP_URL, except for an invalid
 * state (400), and it is never cached or sent on as a referrer.
 */
@Controller('platform/integrations/oauth')
export class OAuthCallbackController {
  constructor(private readonly oauth: OAuthConnectService) {}

  @Get(':provider/callback')
  @UseGuards(OAuthCallbackRateLimitGuard)
  async callback(@Param('provider', ProviderParam) slug: string, @Query() query: Record<string, unknown>, @Res() res: Response): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const parsed = OAuthCallbackQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException({ statusCode: 400, code: 'OAUTH_STATE_INVALID', message: 'Geçersiz veya süresi dolmuş yetkilendirme isteği' });
    const target = await this.oauth.callback(providerOf(slug), parsed.data);
    res.redirect(302, target);
  }
}

/** Super admin only: OAuth client id / secret per provider (masked in every response). */
@Controller('admin/integrations/oauth')
@SuperAdminOnly()
export class AdminOAuthClientsController {
  constructor(private readonly clients: OAuthClientSettingsService) {}

  @Get()
  list() {
    return this.clients.list();
  }

  @Put(':provider')
  set(@CurrentUser() user: AuthUser, @Param('provider', ProviderParam) slug: string, @ZodBody(SetOAuthClientSchema) body: SetOAuthClientInput) {
    return this.clients.set(providerOf(slug), user.id, body);
  }

  @Delete(':provider')
  remove(@CurrentUser() user: AuthUser, @Param('provider', ProviderParam) slug: string) {
    return this.clients.remove(providerOf(slug), user.id);
  }
}
