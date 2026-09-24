import { createParamDecorator, ExecutionContext, InternalServerErrorException } from '@nestjs/common';
import type { AuthenticatedRequest, AuthUser, TenantContext } from '../tenant-context';

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
  if (!user) throw new InternalServerErrorException('CurrentUser used without JwtAuthGuard');
  return user;
});

/** The resolved tenant of a @StudioScoped() route. */
export const Tenant = createParamDecorator((_data: unknown, ctx: ExecutionContext): TenantContext => {
  const tenant = ctx.switchToHttp().getRequest<AuthenticatedRequest>().tenant;
  if (!tenant) throw new InternalServerErrorException('Tenant used without StudioTenantGuard');
  return tenant;
});
