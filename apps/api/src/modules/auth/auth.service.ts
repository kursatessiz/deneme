import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginInput } from '@platform/shared';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async login(dto: LoginInput) {
    // Find user by email or phone
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: dto.emailOrPhone },
          { phone: dto.emailOrPhone },
        ],
      },
      include: {
        studio: true,
        memberProfile: true,
        trainerProfile: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Hatalı e-posta/telefon veya şifre');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Hesabınız askıya alınmıştır');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Hatalı e-posta/telefon veya şifre');
    }

    const payload = {
      sub: user.id,
      email: user.email,
      phone: user.phone,
      role: user.role,
      studioId: user.studioId,
    };

    // The typ claim keeps a refresh token from being accepted as an access token.
    const accessToken = this.jwtService.sign({ ...payload, typ: 'access' }, {
      expiresIn: '1d',
    });

    const refreshToken = this.jwtService.sign({ ...payload, typ: 'refresh' }, {
      expiresIn: '30d',
    });

    // Hash and store refresh token for security
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshTokenHash },
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        studioId: user.studioId,
        studioName: user.studio?.name,
        memberProfileId: user.memberProfile?.id,
        trainerProfileId: user.trainerProfile?.id,
      },
    };
  }

  async refreshToken(incomingRefreshToken: string) {
    if (!incomingRefreshToken) {
      throw new UnauthorizedException('Oturum geçersiz');
    }

    let claims: { sub: string; typ?: string };
    try {
      claims = this.jwtService.verify(incomingRefreshToken);
    } catch {
      throw new UnauthorizedException('Oturum geçersiz');
    }
    if (claims.typ !== 'refresh') {
      throw new UnauthorizedException('Oturum geçersiz');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
    });

    if (!user || !user.isActive || !user.refreshTokenHash) {
      throw new UnauthorizedException('Oturum geçersiz');
    }

    const isTokenMatch = await bcrypt.compare(incomingRefreshToken, user.refreshTokenHash);
    if (!isTokenMatch) {
      throw new UnauthorizedException('Yenileme jetonu geçersiz');
    }

    const payload = {
      sub: user.id,
      email: user.email,
      phone: user.phone,
      role: user.role,
      studioId: user.studioId,
    };

    const newAccessToken = this.jwtService.sign({ ...payload, typ: 'access' }, { expiresIn: '1d' });
    return { accessToken: newAccessToken };
  }
}
