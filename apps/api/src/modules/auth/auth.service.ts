import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { LoginInput, MembershipDTO, SessionUserDTO, normalizePhone, resolvePermissions } from '@platform/shared';
import { OtpPurpose } from '@platform/database';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from '../otp/otp.service';
import { toAppearance, toTenantTheme } from '../appearance/theme-mapping';
import { loadAllowedThemeFamilies } from '../appearance/theme-families';
import { LoginThrottleService } from './login-throttle.service';
import { isStudioBillingStatus } from '@platform/shared';
import { loadPlatformAccess, requireTwoFactorForPlatformRoles } from './platform-access';
import { apiError } from '../../common/api-error';
import { pickBundledLocale, requestedLocale, requestT, serverT } from '../../common/server-i18n';

export const PIN_MAX_FAILURES = 5;
/** Refresh token lifetime of super admins and platform members (tenant users keep 30 days). */
export const PLATFORM_REFRESH_TTL = '7d';
/** A refresh token replaced less than this long ago may still arrive from a parallel request of the same client. */
export const REFRESH_GRACE_MS = 60 * 1000;
export const PIN_LOCK_MS = 15 * 60 * 1000;
const INVALID_CODE = apiError('apiErrors.invites.codeInvalidExpired');
const INVALID_PIN = apiError('apiErrors.auth.incorrectPhoneNumberPin');

const INVALID_CREDENTIALS = apiError('apiErrors.auth.incorrectEmailPhonePassword');
// Compared against when the user does not exist, so response time does not
// reveal which phone numbers are registered.
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer', 10);

/**
 * SHA-256 hex of the whole refresh token. bcrypt only reads the first 72
 * bytes, which are identical across one user's JWTs, so it cannot tell a
 * rotated token from the current one.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Constant-time comparison of a presented refresh token with the stored hash. */
export function refreshTokenMatches(token: string, storedHash: string): boolean {
  const presented = Buffer.from(hashRefreshToken(token), 'utf8');
  const stored = Buffer.from(storedHash, 'utf8');
  return presented.length === stored.length && timingSafeEqual(presented, stored);
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private otp: OtpService,
    private throttle: LoginThrottleService,
  ) {}

  /**
   * Always answers the same way whether or not the phone is registered;
   * unregistered phones get no SMS (no enumeration, no SMS pumping).
   */
  async requestLoginOtp(phone: string, ip: string | null) {
    const user = await this.prisma.user.findUnique({ where: { phone }, select: { isActive: true, locale: true } });
    // The code is texted in the user's own language, else the one the request asked for.
    const sms = serverT(pickBundledLocale([user?.locale, requestedLocale()]));
    await this.otp.issue({
      phone,
      purpose: OtpPurpose.LOGIN,
      ip,
      deliver: Boolean(user?.isActive),
      studioId: null,
      message: (code) => sms('apiTexts.otp.loginSms', { code }),
    });
    return { message: requestT()('apiTexts.otp.loginRequested'), messageKey: 'apiTexts.otp.loginRequested' as const };
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

  async pinLogin(phone: string, pin: string, ip: string | null = null) {
    await this.throttle.reserveAttempt('pin', phone, ip);
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
      throw new ForbiddenException(apiError('apiErrors.auth.tooManyFailedAttemptsAccountTemporarily'));
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
    await this.throttle.recordSuccess('pin', phone, ip);
    const tokens = await this.issueTokens(user.id);
    return { ...tokens, user: await this.sessionUser(user.id) };
  }

  /**
   * Changing the PIN revokes the stored refresh token (any other session
   * signs in again) and hands the caller a fresh pair for its own session.
   */
  async setPin(userId: string, pin: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { pinHash: await bcrypt.hash(pin, 10), failedPinAttempts: 0, pinLockedUntil: null, refreshTokenHash: null, prevRefreshTokenHash: null, refreshRotatedAt: null, sessionEpoch: { increment: 1 } },
    });
    return this.issueTokens(userId);
  }

  async login(dto: LoginInput, ip: string | null = null) {
    const phone = normalizePhone(dto.emailOrPhone);
    const email = dto.emailOrPhone.includes('@') ? dto.emailOrPhone.trim().toLowerCase() : null;
    // Throttle on the canonical form so "0532..." and "+90532..." share one budget.
    const identifier = phone ?? email ?? dto.emailOrPhone;
    await this.throttle.reserveAttempt('password', identifier, ip);

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
    await this.throttle.recordSuccess('password', identifier, ip);
    if (!user.isActive) {
      throw new UnauthorizedException(apiError('apiErrors.auth.accountSuspended'));
    }

    const tokens = await this.issueTokens(user.id);
    return { ...tokens, user: await this.sessionUser(user.id) };
  }

  async refreshToken(incomingRefreshToken: string) {
    if (!incomingRefreshToken) throw new UnauthorizedException(apiError('apiErrors.auth.invalidSession'));

    let claims: { sub?: string; typ?: string; ep?: number };
    try {
      claims = this.jwtService.verify(incomingRefreshToken);
    } catch {
      throw new UnauthorizedException(apiError('apiErrors.auth.invalidSession'));
    }
    if (claims.typ !== 'refresh' || !claims.sub) throw new UnauthorizedException(apiError('apiErrors.auth.invalidSession'));

    const user = await this.prisma.user.findUnique({ where: { id: claims.sub } });
    if (!user || !user.isActive || !user.refreshTokenHash) throw new UnauthorizedException(apiError('apiErrors.auth.invalidSession'));

    // A token from before the last revocation is simply stale.
    if ((typeof claims.ep === 'number' ? claims.ep : 0) !== user.sessionEpoch) throw new UnauthorizedException(apiError('apiErrors.auth.invalidSession'));

    if (!refreshTokenMatches(incomingRefreshToken, user.refreshTokenHash)) {
      // The token the last rotation replaced, presented within the grace window, is a parallel
      // refresh of the same client that lost the race: refuse this call, keep the winner's session.
      const rotatedAgo = user.refreshRotatedAt ? Date.now() - user.refreshRotatedAt.getTime() : Infinity;
      if (user.prevRefreshTokenHash && rotatedAgo <= REFRESH_GRACE_MS && refreshTokenMatches(incomingRefreshToken, user.prevRefreshTokenHash)) {
        throw new UnauthorizedException(apiError('apiErrors.auth.invalidRefreshToken'));
      }
      // Validly signed but matching neither: a stale copy is in someone's hands, so every session
      // of the user is revoked (epoch bump, stored hashes cleared).
      await this.prisma.user.updateMany({
        where: { id: user.id, sessionEpoch: user.sessionEpoch },
        data: { sessionEpoch: { increment: 1 }, refreshTokenHash: null, prevRefreshTokenHash: null, refreshRotatedAt: null },
      });
      throw new UnauthorizedException(apiError('apiErrors.auth.invalidRefreshToken'));
    }

    // Rotate: the presented refresh token cannot be used again. A session that
    // passed the TOTP step keeps it, unless 2FA was reset or re-enrolled since.
    const mfa = (claims as { mfa?: unknown }).mfa;
    const keepMfa = user.mfaEnabledAt !== null && mfa === user.mfaEnabledAt.getTime();
    return this.issueTokens(user.id, keepMfa ? user.mfaEnabledAt : null, user.refreshTokenHash);
  }

  async logout(userId: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { refreshTokenHash: null, prevRefreshTokenHash: null, refreshRotatedAt: null, sessionEpoch: { increment: 1 } } });
  }

  /** The user plus every active or invited membership with resolved permissions. */
  async sessionUser(userId: string, session: { mfaVerified?: boolean } = {}): Promise<SessionUserDTO> {
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
                defaultLocale: true,
                currency: true,
                billingStatus: true,
                trialEndsAt: true,
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

    const allowedFamilies = await loadAllowedThemeFamilies(this.prisma, [...new Set(user.memberships.map((m) => m.studio.id))]);

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
      theme: { ...toTenantTheme(m.studio), allowedThemeFamilies: allowedFamilies.get(m.studio.id) },
      defaultLocale: m.studio.defaultLocale,
      currency: m.studio.currency,
      billing: {
        status: isStudioBillingStatus(m.studio.billingStatus) ? m.studio.billingStatus : 'ACTIVE',
        trialEndsAt: m.studio.trialEndsAt?.toISOString() ?? null,
      },
    }));

    // M1: platform access and 2FA state for the web shells (/admin, /pazarlama).
    const access = await loadPlatformAccess(this.prisma, user);
    const platformStudio = access ? await this.prisma.studio.findFirst({ where: { isPlatform: true }, select: { id: true } }) : null;
    const mfaEnabled = user.mfaEnabledAt !== null;
    const enrollmentRequired = Boolean(access) && !mfaEnabled && (user.isSuperAdmin || (await requireTwoFactorForPlatformRoles(this.prisma)));

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
      locale: user.locale,
      platformAccess: access ? { permissions: access.permissions, platformStudioId: platformStudio?.id ?? null, roleName: access.roleName } : null,
      mfa: { enabled: mfaEnabled, verified: mfaEnabled && session.mfaVerified === true, enrollmentRequired },
    };
  }

  /**
   * `mfaEnabledAt`: set only right after the TOTP step (MfaService); binds the
   * `mfa` claim to the current enrolment so a reset invalidates it.
   */
  async issueTokens(userId: string, mfaEnabledAt: Date | null = null, rotatedFromHash: string | null = null) {
    const mfa = mfaEnabledAt ? { mfa: mfaEnabledAt.getTime() } : {};
    // Platform-level accounts get a shorter refresh window (docs/PAZARLAMA_MODULU.md 6.3).
    const account = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isSuperAdmin: true, sessionEpoch: true, platformMembership: { select: { status: true } } },
    });
    const ep = { ep: account?.sessionEpoch ?? 0 };
    const accessToken = this.jwtService.sign({ sub: userId, typ: 'access', ...ep, ...mfa }, { expiresIn: '1h' });
    const isPlatformAccount = Boolean(account?.isSuperAdmin || account?.platformMembership?.status === 'ACTIVE');
    const refreshToken = this.jwtService.sign(
      // jti makes every refresh token unique, even two issued in the same second.
      { sub: userId, typ: 'refresh', jti: randomUUID(), ...ep, ...mfa },
      { expiresIn: isPlatformAccount ? PLATFORM_REFRESH_TTL : '30d' },
    );
    if (rotatedFromHash) {
      // Rotation: only the request that still holds the current token may replace it, so two
      // parallel refreshes cannot both succeed. The replaced hash is kept for the grace window.
      const swapped = await this.prisma.user.updateMany({
        where: { id: userId, refreshTokenHash: rotatedFromHash },
        data: { refreshTokenHash: hashRefreshToken(refreshToken), prevRefreshTokenHash: rotatedFromHash, refreshRotatedAt: new Date() },
      });
      if (swapped.count === 0) throw new UnauthorizedException(apiError('apiErrors.auth.invalidRefreshToken'));
    } else {
      await this.prisma.user.update({
        where: { id: userId },
        data: { refreshTokenHash: hashRefreshToken(refreshToken), prevRefreshTokenHash: null, refreshRotatedAt: null },
      });
    }
    return { accessToken, refreshToken };
  }
}
