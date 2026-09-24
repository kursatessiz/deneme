import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: { sub: string; email: string; role: string; studioId?: string; typ?: string }) {
    if (payload.typ !== 'access') {
      throw new UnauthorizedException('Geçersiz oturum anahtarı');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        studio: true,
        memberProfile: true,
        trainerProfile: true,
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Kullanıcı bulunamadı veya hesabı devre dışı');
    }

    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      studioId: user.studioId,
      studio: user.studio,
      memberProfileId: user.memberProfile?.id,
      trainerProfileId: user.trainerProfile?.id,
    };
  }
}
