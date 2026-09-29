import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from './tenant-context';

export interface AccessTokenClaims {
  sub: string;
  typ: 'access';
  /**
   * Present when the session passed the TOTP step (M1): the user's
   * mfaEnabledAt in epoch ms, so a 2FA reset or re-enrolment invalidates it.
   */
  mfa?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
      algorithms: ['HS256'],
    });
  }

  async validate(payload: { sub?: string; typ?: string; mfa?: unknown }): Promise<AuthUser> {
    if (payload.typ !== 'access' || !payload.sub) {
      throw new UnauthorizedException('Geçersiz oturum anahtarı');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, phone: true, firstName: true, lastName: true, isSuperAdmin: true, isActive: true, mfaEnabledAt: true },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Kullanıcı bulunamadı veya hesabı devre dışı');
    }

    return {
      id: user.id,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      isSuperAdmin: user.isSuperAdmin,
      mfaEnabled: user.mfaEnabledAt !== null,
      // Bound to the enrolment: a claim from before a reset or re-enrolment is not trusted.
      mfaVerified: user.mfaEnabledAt !== null && payload.mfa === user.mfaEnabledAt.getTime(),
    };
  }
}
