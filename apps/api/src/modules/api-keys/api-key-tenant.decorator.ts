import { createParamDecorator, ExecutionContext, InternalServerErrorException } from '@nestjs/common';
import type { ApiKeyAuthenticatedRequest, ApiKeyTenantContext } from './api-key-tenant-context';

/** The resolved tenant of a @PublicApiScoped() route. */
export const ApiKeyTenant = createParamDecorator((_data: unknown, ctx: ExecutionContext): ApiKeyTenantContext => {
  const tenant = ctx.switchToHttp().getRequest<ApiKeyAuthenticatedRequest>().apiKeyTenant;
  if (!tenant) throw new InternalServerErrorException('ApiKeyTenant used without ApiKeyGuard');
  return tenant;
});
