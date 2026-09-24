import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import type { KioskContext, KioskRequest, KioskTokenClaims } from './kiosk-context';

const INVALID = 'Kiosk oturumu geçersiz';

/**
 * Accepts only a kiosk-typed JWT (typ "kiosk") issued by KioskService.pair.
 * A normal access/refresh JWT is rejected here, and a kiosk JWT is rejected
 * by JwtStrategy (which only accepts typ "access") -- so a kiosk token
 * cannot reach any endpoint outside this guard, and vice versa. Revocation
 * (KioskDevice.revokedAt) is checked against the database on every request,
 * so a revoked kiosk is denied immediately, not only once its JWT expires.
 */
@Injectable()
export class KioskAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<KioskRequest>();
    const header = request.headers['authorization'];
    const raw = Array.isArray(header) ? header[0] : header;
    if (!raw?.startsWith('Bearer ')) throw new UnauthorizedException(INVALID);
    const token = raw.slice('Bearer '.length);

    let claims: KioskTokenClaims;
    try {
      claims = this.jwt.verify<KioskTokenClaims>(token);
    } catch {
      throw new UnauthorizedException(INVALID);
    }
    if (claims.typ !== 'kiosk' || !claims.sub) throw new UnauthorizedException(INVALID);

    const device = await this.prisma.kioskDevice.findUnique({ where: { id: claims.sub } });
    if (!device || device.revokedAt || device.studioId !== claims.studioId || device.branchId !== claims.branchId) {
      throw new UnauthorizedException(INVALID);
    }

    const kiosk: KioskContext = { deviceId: device.id, studioId: device.studioId, branchId: device.branchId };
    request.kiosk = kiosk;

    // Best-effort liveness marker; never blocks the request.
    this.prisma.kioskDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
    return true;
  }
}
