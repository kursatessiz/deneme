import { SetMetadata, UseGuards, applyDecorators } from '@nestjs/common';
import type { ApiKeyScope } from '@platform/shared';
import { ApiKeyGuard } from './api-key.guard';
import { ApiKeyRateLimitGuard } from './api-key-rate-limit.guard';

export const REQUIRE_SCOPE_KEY = 'requiredApiKeyScopes';

/** ApiKeyGuard + per-key rate limit + the scope(s) this /v1/public/* endpoint needs. */
export const PublicApiScoped = (...scopes: ApiKeyScope[]) =>
  applyDecorators(SetMetadata(REQUIRE_SCOPE_KEY, scopes), UseGuards(ApiKeyGuard, ApiKeyRateLimitGuard));
