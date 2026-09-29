import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ALL_PERMISSIONS, isPlatformSystemRoleKey, resolvePermissions } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedRequest, TenantContext } from '../tenant-context';
import { mfaGateError, platformAccessDenied, platformMfaGate, requireTwoFactorForPlatformRoles } from '../platform-access';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves which studio a request acts on and loads the caller's active
 * membership and permissions from the database on every request, so role
 * changes and deactivations take effect immediately.
 *
 * The studio comes from the :studioId route param, the x-studio-id header,
 * or a studioId field in the body or query. When several are present they
 * must all agree. Membership is always verified against the database, and
 * services must use request.tenant.studioId, never a client-supplied value.
 */
@Injectable()
export class StudioTenantGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) throw new UnauthorizedException('Kullanıcı oturumu bulunamadı');

    const studioId = this.resolveStudioId(request);

    // A super admin who enrolled 2FA but whose session skipped the TOTP step
    // gets no bypass: only their own memberships apply (docs/PAZARLAMA_MODULU.md 6.3).
    if (user.isSuperAdmin && !(user.mfaEnabled && !user.mfaVerified)) {
      const studio = await this.prisma.studio.findUnique({ where: { id: studioId }, select: { id: true } });
      if (!studio) throw new ForbiddenException('İşletme bulunamadı');
      request.tenant = {
        studioId,
        membershipId: null,
        isOwner: true,
        isSuperAdmin: true,
        permissions: new Set(ALL_PERMISSIONS),
        billingStatus: undefined,
        memberProfileId: null,
        trainerProfileId: null,
        branchIds: null,
      };
      return true;
    }

    const membership = await this.prisma.membership.findUnique({
      where: { userId_studioId: { userId: user.id, studioId } },
      include: {
        roleTemplate: { include: { permissions: true } },
        memberProfile: { select: { id: true } },
        trainerProfile: { select: { id: true } },
        studio: { select: { isActive: true, billingStatus: true, isPlatform: true } },
        branchAccess: { select: { branchId: true } },
        user: { select: { platformMembership: { select: { status: true, platformStudioMembershipId: true } } } },
      },
    });

    // Same error for "not a member" and "inactive" so studio ids cannot be probed.
    if (!membership || membership.status !== 'ACTIVE' || !membership.studio.isActive) {
      throw new ForbiddenException('Bu işletmeye erişim yetkiniz yok');
    }

    // Platform system role (M1): the membership only stands while the
    // user's PlatformMembership is ACTIVE and points at it, so a revocation
    // takes effect on the next request even if the sync ever failed.
    const roleKey = membership.roleTemplate.key;
    if (typeof roleKey === 'string' && membership.roleTemplate.isSystem && isPlatformSystemRoleKey(roleKey)) {
      const pm = membership.user?.platformMembership;
      if (!membership.studio.isPlatform || !pm || pm.status !== 'ACTIVE' || pm.platformStudioMembershipId !== membership.id) {
        throw platformAccessDenied();
      }
      const gate = platformMfaGate(user, await requireTwoFactorForPlatformRoles(this.prisma));
      if (gate !== 'ok') throw mfaGateError(gate);
    }

    const tenant: TenantContext = {
      studioId,
      membershipId: membership.id,
      isOwner: membership.roleTemplate.isOwner,
      isSuperAdmin: false,
      permissions: new Set(
        resolvePermissions({
          isOwner: membership.roleTemplate.isOwner,
          permissions: membership.roleTemplate.permissions.map((p) => p.permissionKey),
        }),
      ),
      memberProfileId: membership.memberProfile?.id ?? null,
      trainerProfileId: membership.trainerProfile?.id ?? null,
      // The owner is never branch-restricted, whatever rows exist.
      branchIds:
        membership.roleTemplate.isOwner || membership.branchAccess.length === 0
          ? null
          : new Set(membership.branchAccess.map((b) => b.branchId)),
      billingStatus: membership.studio.billingStatus,
    };
    request.tenant = tenant;
    return true;
  }

  private resolveStudioId(request: AuthenticatedRequest): string {
    const header = request.headers['x-studio-id'];
    const body = (request.body as { studioId?: unknown } | undefined)?.studioId;
    const candidates = [
      request.params?.studioId,
      Array.isArray(header) ? header[0] : header,
      body,
      request.query?.studioId,
    ].filter((value) => value !== undefined && value !== null && value !== '');

    // Every place that names a studio must name the same one.
    const distinct = new Set(candidates);
    if (distinct.size > 1) {
      throw new ForbiddenException('Farklı bir işletmenin verilerine erişim yetkiniz yok');
    }

    const studioId = candidates[0];
    if (typeof studioId !== 'string' || !UUID.test(studioId)) {
      throw new BadRequestException('Geçerli bir işletme seçilmedi');
    }
    return studioId;
  }
}
