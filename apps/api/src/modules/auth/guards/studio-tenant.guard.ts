import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Role } from '@platform/database';

@Injectable()
export class StudioTenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Kullanıcı oturumu bulunamadı');
    }

    // Super Admin can access any tenant/studio
    if (user.role === Role.SUPER_ADMIN) {
      return true;
    }

    // Target studio from params, body, or header
    const requestedStudioId =
      request.params.studioId ||
      request.body?.studioId ||
      request.query?.studioId ||
      request.headers['x-studio-id'];

    if (requestedStudioId && user.studioId && requestedStudioId !== user.studioId) {
      throw new ForbiddenException('Farklı bir stüdyonun verilerine erişim yetkiniz yok');
    }

    // Attach tenant studioId to request object for seamless query scoping
    request.studioId = user.studioId;

    return true;
  }
}
