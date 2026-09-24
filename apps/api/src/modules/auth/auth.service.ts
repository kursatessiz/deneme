import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { LoginInput, MembershipDTO, SessionUserDTO, normalizePhone, resolvePermissions } from '@platform/shared';
import { OtpPurpose } from '@platform/database';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from '../otp/otp.service';
import { toAppearance, toTenantTheme } from '../appearance/theme-mapping';

export const PIN_MAX_FAILURES = 5;
export const PIN_LOCK_MS = 15 * 60 * 1000;
const INVALID_CODE = 'Kod geçersiz veya süresi dolmuş';
const INVALID_PIN = 'Telefon numarası veya PIN hatalı';

const INVALID_CREDENTIALS = 'Hatalı e-posta/telefon veya şifre';
// Compared against when the user does not exist, so response time does not
// reveal which phone numbers are registered.
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer', 10);

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private otp: OtpService,
  ) {}

  /**
   * Always answers the same way whether or not the phone is registered;
   * unregistered phones get no SMS (no enumeration, no SMS pumping).
   */
  async requestLoginOtp(phone: string, ip: string | null) {
    const user = await this.prisma.user.findUnique({ where: { phone }, select: { isActive: true } });
    await this.otp.issue({
      phone,
      purpose: OtpPurpose.LOGIN,
      ip,
      deliver: Boolean(user?.isActive),
      studioId: null,
      message: (code) => `Giris kodunuz: ${code}. Kodu kimseyle paylasmayin.`,
    });
    return { message: 'Numara kayıtlıysa doğrulama kodu gönderildi' };
  }

  async verifyLoginOtp(phone: string, code: string) {
    const ok = await this.otp.verify(phone, OtpPurpose.LOGIN, code);
    const user = ok ? await this.prisma.user.findUnique({ where: { phone } }) : null;
    if (!ok || !user || !user.isActive) throw new UnauthorizedException(INVALID_CODE);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { phoneVerifiedAt: user.phoneVerifiedAt ?? new Date(), failedPinAttempts: 0, pinLockedUntil: null },
    });
    const tokens = await this.issueTokens(user.id);
    return { ...tokens, user: await this.sessionUser(user.id), hasPin: Boolean(user.pinHash) };
  }

  async pinLogin(phone: string, pin: string) {
    const user = await this.prisma.user.findUnique({ where: { phone } });
    const now = new Date();

    if (!user || !user.pinHash || !user.isActive) {
      await bcrypt.compare(pin, DUMMY_HASH);
      throw new UnauthorizedException(INVALID_PIN);
    }

    // Reserve an attempt before comparing, atomically, so parallel guesses
    // cannot exceed PIN_MAX_FAILURES per lock period.
    const reserved = await this.prisma.user.updateMany({
      where: {
        id: user.id,
        failedPinAttempts: { lt: PIN_MAX_FAILURES },
        OR: [{ pinLockedUntil: null }, { pinLockedUntil: { lte: now } }],
      },
      data: { failedPinAttempts: { increment: 1 }, pinLockedUntil: null },
    });
    if (reserved.count === 0) {
      throw new ForbiddenException('Çok fazla hatalı deneme. Hesap geçici olarak kilitlendi, SMS kodu ile giriş yapın');
    }

    if (!(await bcrypt.compare(pin, user.pinHash))) {
      const after = await this.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { failedPinAttempts: true },
      });
      if (after.failedPinAttempts >= PIN_MAX_FAILURES) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { failedPinAttempts: 0, pinLockedUntil: new Date(now.getTime() + PIN_LOCK_MS) },
        });
      }
      throw new UnauthorizedException(INVALID_PIN);
    }

    await this.prisma.user.update({ where: { id: user.id }, data: { failedPinAttempts: 0, pinLockedUntil: null } });
    const tokens = await this.issueTokens(user.id);
    return { ...tokens, user: await this.sessionUser(user.id) };
  }

  async setPin(userId: string, pin: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { pinHash: await bcrypt.hash(pin, 10), failedPinAttempts: 0, pinLockedUntil: null },
    });
  }

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
            studio: {
              select: {
                id: true,
                name: true,
                slug: true,
                logoUrl: true,
                themeFamily: true,
                themePrimary: true,
                gradientPresetKey: true,
              },
            },
            roleTemplate: { include: { permissions: true } },
            memberProfile: { select: { id: true, homeBranchId: true } },
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
      homeBranchId: m.memberProfile?.homeBranchId ?? null,
      theme: toTenantTheme(m.studio),
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
      appearance: toAppearance(user),
    };
  }

  async issueTokens(userId: string) {
    const accessToken = this.jwtService.sign({ sub: userId, typ: 'access' }, { expiresIn: '1h' });
    const refreshToken = this.jwtService.sign({ sub: userId, typ: 'refresh' }, { expiresIn: '30d' });
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash: await bcrypt.hash(refreshToken, 10) },
    });
    return { accessToken, refreshToken };
  }
}
