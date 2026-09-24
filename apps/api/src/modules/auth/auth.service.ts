import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { LoginInput, MembershipDTO, SessionUserDTO, normalizePhone, resolvePermissions } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';

const INVALID_CREDENTIALS = 'Hatalı e-posta/telefon veya şifre';
// Compared against when the user does not exist, so response time does not
// reveal which phone numbers are registered.
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer', 10);

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async login(dto: LoginInput) {
    const phone = normalizePhone(dto.emailOrPhone);
    const email = dto.emailOrPhone.includes('@') ? dto.emailOrPhone.trim().toLowerCase() : null;

    const user =
      phone || email
        ? await this.prisma.user.findFirst({
            where: { OR: [...(phone ? [{ phone }] : []), ...(email ? [{ email }] : [])] },
          })
        : null;

    const passwordOk = await bcrypt.compare(dto.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !user.passwordHash || !passwordOk) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Hesabınız askıya alınmıştır');
    }

    const tokens = await this.issueTokens(user.id);
    return { ...tokens, user: await this.sessionUser(user.id) };
  }

  async refreshToken(incomingRefreshToken: string) {
    if (!incomingRefreshToken) throw new UnauthorizedException('Oturum geçersiz');

    let claims: { sub?: string; typ?: string };
    try {
      claims = this.jwtService.verify(incomingRefreshToken);
    } catch {
      throw new UnauthorizedException('Oturum geçersiz');
    }
    if (claims.typ !== 'refresh' || !claims.sub) throw new UnauthorizedException('Oturum geçersiz');

    const user = await this.prisma.user.findUnique({ where: { id: claims.sub } });
    if (!user || !user.isActive || !user.refreshTokenHash) throw new UnauthorizedException('Oturum geçersiz');

    const isTokenMatch = await bcrypt.compare(incomingRefreshToken, user.refreshTokenHash);
    if (!isTokenMatch) throw new UnauthorizedException('Yenileme jetonu geçersiz');

    // Rotate: the presented refresh token cannot be used again.
    return this.issueTokens(user.id);
  }

  async logout(userId: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { refreshTokenHash: null } });
  }

  /** The user plus every active or invited membership with resolved permissions. */
  async sessionUser(userId: string): Promise<SessionUserDTO> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        memberships: {
          where: { status: { in: ['ACTIVE', 'INVITED'] }, studio: { isActive: true } },
          include: {
            studio: { select: { id: true, name: true, slug: true } },
            roleTemplate: { include: { permissions: true } },
            memberProfile: { select: { id: true } },
            trainerProfile: { select: { id: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    const memberships: MembershipDTO[] = user.memberships.map((m) => ({
      id: m.id,
      studioId: m.studio.id,
      studioName: m.studio.name,
      studioSlug: m.studio.slug,
      status: m.status as MembershipDTO['status'],
      roleKey: m.roleTemplate.key,
      roleName: m.roleTemplate.name,
      isOwner: m.roleTemplate.isOwner,
      permissions: resolvePermissions({
        isOwner: m.roleTemplate.isOwner,
        permissions: m.roleTemplate.permissions.map((p) => p.permissionKey),
      }),
      memberProfileId: m.memberProfile?.id ?? null,
      trainerProfileId: m.trainerProfile?.id ?? null,
    }));

    return {
      id: user.id,
      phone: user.phone,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl,
      isSuperAdmin: user.isSuperAdmin,
      memberships,
    };
  }

  private async issueTokens(userId: string) {
    const accessToken = this.jwtService.sign({ sub: userId, typ: 'access' }, { expiresIn: '1h' });
    const refreshToken = this.jwtService.sign({ sub: userId, typ: 'refresh' }, { expiresIn: '30d' });
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash: await bcrypt.hash(refreshToken, 10) },
    });
    return { accessToken, refreshToken };
  }
}
