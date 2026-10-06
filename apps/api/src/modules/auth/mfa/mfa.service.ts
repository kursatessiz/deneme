import { BadRequestException, ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@platform/database';
import { MFA_RECOVERY_CODE_COUNT, PLATFORM_ACCESS_ERROR_CODES, type MfaEnrollmentDTO, type MfaVerifyInput } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CredentialCipher } from '../../../common/crypto/credential-cipher';
import { AuthService } from '../auth.service';
import { LoginThrottleService } from '../login-throttle.service';
import { loadPlatformAccess } from '../platform-access';
import { generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, otpauthUrl, verifyTotp } from './totp';
import { apiError, codedError } from '../../../common/api-error';

/** Issuer shown in authenticator apps; product-neutral (CLAUDE.md). */
const DEFAULT_ISSUER = 'Platform';

function invalidCode(): UnauthorizedException {
  return new UnauthorizedException(codedError(PLATFORM_ACCESS_ERROR_CODES.mfaInvalidCode, { statusCode: 401 }));
}

/**
 * TOTP two-step verification for platform-level accounts (super admin and
 * platform members; docs/PAZARLAMA_MODULU.md 6.3). Step-up model: every
 * existing login (password, PIN, SMS code) still returns a session, and
 * POST /auth/mfa/verify upgrades it to one carrying the `mfa` claim that
 * platform guards require. The secret is stored with CredentialCipher and
 * recovery codes only as hashes. Failed attempts count against the login
 * throttle (kind 'mfa', keyed by user id).
 */
@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: CredentialCipher,
    private readonly auth: AuthService,
    private readonly throttle: LoginThrottleService,
    private readonly config: ConfigService,
  ) {}

  /** Starts (or restarts) enrolment: a new pending secret, not yet active. */
  async beginEnrollment(userId: string): Promise<MfaEnrollmentDTO> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await loadPlatformAccess(this.prisma, user)) && !(await this.hasPendingPlatformInvite(userId))) {
      throw new ForbiddenException(apiError('apiErrors.auth.twoFactorAuthenticationOnlyPlatformAccounts'));
    }
    if (user.mfaEnabledAt) throw new ConflictException(apiError('apiErrors.auth.twoFactorAuthenticationAlreadyEnabled'));
    if (this.config.get<string>('NODE_ENV') === 'production' && !this.cipher.isConfigured) {
      throw new BadRequestException(apiError('apiErrors.auth.twoFactorAuthenticationCannotEnabledUntil'));
    }
    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecretEncrypted: this.cipher.encrypt(secret), totpLastUsedStep: null },
    });
    const issuer = this.config.get<string>('MFA_ISSUER') ?? DEFAULT_ISSUER;
    return { secret, otpauthUrl: otpauthUrl(secret, user.email ?? user.phone, issuer) };
  }

  /** Confirms the pending secret with a first code; returns recovery codes and an upgraded session. */
  async confirmEnrollment(userId: string, code: string, ip: string | null) {
    await this.throttle.assertAllowed('mfa', userId, ip);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.mfaEnabledAt) throw new ConflictException(apiError('apiErrors.auth.twoFactorAuthenticationAlreadyEnabled'));
    if (!user.totpSecretEncrypted) throw new BadRequestException(apiError('apiErrors.auth.startSetup'));

    const step = verifyTotp(this.cipher.decrypt(user.totpSecretEncrypted), code);
    if (step === null) {
      await this.throttle.recordFailure('mfa', userId, ip);
      throw invalidCode();
    }
    await this.throttle.recordSuccess('mfa', userId);

    const now = new Date();
    const recoveryCodes = generateRecoveryCodes(MFA_RECOVERY_CODE_COUNT);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { mfaEnabledAt: now, totpLastUsedStep: step } });
      await tx.userMfaRecoveryCode.deleteMany({ where: { userId } });
      await tx.userMfaRecoveryCode.createMany({
        data: recoveryCodes.map((c) => ({ userId, codeHash: hashRecoveryCode(c.replace('-', '')) })),
      });
      await tx.auditLog.create({
        data: { studioId: null, userId, action: 'mfa.enabled', entityType: 'User', entityId: userId, metadata: {} as Prisma.InputJsonValue },
      });
    });
    const tokens = await this.auth.issueTokens(userId, now);
    return { ...tokens, user: await this.auth.sessionUser(userId, { mfaVerified: true }), recoveryCodes };
  }

  /** The TOTP step: a current code or one unused recovery code. */
  async verify(userId: string, dto: MfaVerifyInput, ip: string | null) {
    await this.throttle.assertAllowed('mfa', userId, ip);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.mfaEnabledAt || !user.totpSecretEncrypted) throw new BadRequestException(apiError('apiErrors.auth.twoFactorAuthenticationNotEnabled'));

    let ok = false;
    let usedRecovery = false;
    if (dto.code) {
      const step = verifyTotp(this.cipher.decrypt(user.totpSecretEncrypted), dto.code);
      if (step !== null) {
        // Single use: a code (time step) is never accepted twice.
        const claimed = await this.prisma.user.updateMany({
          where: { id: userId, OR: [{ totpLastUsedStep: null }, { totpLastUsedStep: { lt: step } }] },
          data: { totpLastUsedStep: step },
        });
        ok = claimed.count === 1;
      }
    } else if (dto.recoveryCode) {
      const claimed = await this.prisma.userMfaRecoveryCode.updateMany({
        where: { userId, codeHash: hashRecoveryCode(dto.recoveryCode), usedAt: null },
        data: { usedAt: new Date() },
      });
      ok = claimed.count === 1;
      usedRecovery = ok;
    }
    if (!ok) {
      await this.throttle.recordFailure('mfa', userId, ip);
      throw invalidCode();
    }
    await this.throttle.recordSuccess('mfa', userId);
    if (usedRecovery) {
      await this.prisma.auditLog.create({
        data: { studioId: null, userId, action: 'mfa.recovery_code_used', entityType: 'User', entityId: userId, metadata: {} as Prisma.InputJsonValue },
      });
    }
    const tokens = await this.auth.issueTokens(userId, user.mfaEnabledAt);
    return { ...tokens, user: await this.auth.sessionUser(userId, { mfaVerified: true }) };
  }

  /** New set of recovery codes; needs a current TOTP code. */
  async regenerateRecoveryCodes(userId: string, code: string, ip: string | null): Promise<{ recoveryCodes: string[] }> {
    await this.throttle.assertAllowed('mfa', userId, ip);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.mfaEnabledAt || !user.totpSecretEncrypted) throw new BadRequestException(apiError('apiErrors.auth.twoFactorAuthenticationNotEnabled'));
    const step = verifyTotp(this.cipher.decrypt(user.totpSecretEncrypted), code);
    const claimed =
      step === null
        ? { count: 0 }
        : await this.prisma.user.updateMany({
            where: { id: userId, OR: [{ totpLastUsedStep: null }, { totpLastUsedStep: { lt: step } }] },
            data: { totpLastUsedStep: step },
          });
    if (claimed.count !== 1) {
      await this.throttle.recordFailure('mfa', userId, ip);
      throw invalidCode();
    }
    await this.throttle.recordSuccess('mfa', userId);
    const recoveryCodes = generateRecoveryCodes(MFA_RECOVERY_CODE_COUNT);
    await this.prisma.$transaction([
      this.prisma.userMfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.userMfaRecoveryCode.createMany({
        data: recoveryCodes.map((c) => ({ userId, codeHash: hashRecoveryCode(c.replace('-', '')) })),
      }),
      this.prisma.auditLog.create({
        data: { studioId: null, userId, action: 'mfa.recovery_codes_regenerated', entityType: 'User', entityId: userId, metadata: {} as Prisma.InputJsonValue },
      }),
    ]);
    return { recoveryCodes };
  }

  /** Someone invited to the platform may enrol before accepting (the invite itself still has to be accepted). */
  private async hasPendingPlatformInvite(userId: string): Promise<boolean> {
    const pm = await this.prisma.platformMembership.findUnique({ where: { userId }, select: { status: true } });
    return pm?.status === 'INVITED';
  }
}
