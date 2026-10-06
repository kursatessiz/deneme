import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isApiKeyScope, type ApiKeyScope } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { parseApiKey, verifySecret } from './api-key.util';
import { REQUIRE_SCOPE_KEY } from './require-scope.decorator';
import type { ApiKeyAuthenticatedRequest } from './api-key-tenant-context';
import { apiError } from '../../common/api-error';

/**
 * Authenticates `/v1/public/*` requests by `Authorization: Bearer pk_live_...`.
 * Deliberately separate from JwtAuthGuard/StudioTenantGuard: the API key's
 * studio becomes the tenant, and scopes (not RoleTemplate permissions) gate
 * each endpoint via @RequireScope.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ApiKeyAuthenticatedRequest>();
    const header = request.headers['authorization'];
    const value = Array.isArray(header) ? header[0] : header;
    if (!value || !value.startsWith('Bearer ')) {
      throw new UnauthorizedException(apiError('apiErrors.apiKeys.authorizationBearerApiKeyRequired'));
    }
    const parsed = parseApiKey(value.slice('Bearer '.length));
    if (!parsed) {
      throw new UnauthorizedException(apiError('apiErrors.apiKeys.invalidApiKeyFormat'));
    }

    // Prefix is indexed and unique; the secret is verified in-process with a
    // constant-time comparison so no timing signal distinguishes a wrong
    // secret for a real prefix from a wrong prefix.
    const apiKey = await this.prisma.apiKey.findUnique({ where: { prefix: parsed.prefix } });
    if (!apiKey || !verifySecret(parsed.secret, parsed.prefix, apiKey.secretHash)) {
      throw new UnauthorizedException(apiError('apiErrors.apiKeys.invalidApiKey'));
    }
    if (apiKey.revokedAt) {
      throw new UnauthorizedException(apiError('apiErrors.apiKeys.apiKeyRevoked'));
    }
    if (apiKey.expiresAt && apiKey.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException(apiError('apiErrors.apiKeys.apiKeyExpired'));
    }

    const requiredScopes = this.reflector.getAllAndOverride<string[]>(REQUIRE_SCOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const scopes: Set<ApiKeyScope> = new Set(apiKey.scopes.filter(isApiKeyScope));
    if (requiredScopes?.length) {
      const missing = requiredScopes.filter((s) => !scopes.has(s as ApiKeyScope));
      if (missing.length > 0) {
        throw new ForbiddenException(apiError('apiErrors.apiKeys.missingScopes', { scopes: missing.join(', ') }));
      }
    }

    // Best-effort; a failure to record last-used-at never blocks the request.
    this.prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);

    request.apiKeyTenant = { studioId: apiKey.studioId, apiKeyId: apiKey.id, scopes };
    return true;
  }
}
