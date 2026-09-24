import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { OtpPurpose } from '@platform/database';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
export const OTP_WINDOW_MS = 15 * 60 * 1000;
export const OTP_MAX_PER_PHONE = 3;
export const OTP_MAX_PER_IP = 10;

export class TooManyRequestsException extends HttpException {
  constructor(message = 'Çok fazla deneme yapıldı, lütfen biraz sonra tekrar deneyin') {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}

/**
 * Issues and checks six-digit one-time codes. Only an HMAC of
 * (purpose, phone, code) is stored, so a database leak does not reveal
 * codes and a code for one phone or purpose cannot be replayed on another.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly key: Buffer;
  private readonly testCode: string | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    config: ConfigService,
  ) {
    // Domain-separated from the JWT signing key.
    this.key = createHmac('sha256', config.getOrThrow<string>('JWT_SECRET')).update('otp-v1').digest();
    this.testCode = config.get<string>('OTP_TEST_CODE');
  }

  /**
   * Rate-limits by phone and by IP, then stores a challenge. Sends the SMS
   * only when `deliver` is true: callers pass false for unknown phones so
   * the response looks the same but no SMS credit is spent.
   */
  async issue(params: {
    phone: string;
    purpose: OtpPurpose;
    ip: string | null;
    deliver: boolean;
    studioId: string | null;
    message: (code: string) => string;
  }): Promise<void> {
    const now = Date.now();
    const windowStart = new Date(now - OTP_WINDOW_MS);

    const [recentForPhone, recentForIp, latest] = await Promise.all([
      this.prisma.otpChallenge.count({
        where: { phone: params.phone, purpose: params.purpose, createdAt: { gte: windowStart } },
      }),
      params.ip
        ? this.prisma.otpChallenge.count({ where: { requestIp: params.ip, createdAt: { gte: windowStart } } })
        : Promise.resolve(0),
      this.prisma.otpChallenge.findFirst({
        where: { phone: params.phone, purpose: params.purpose },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    if (
      recentForPhone >= OTP_MAX_PER_PHONE ||
      recentForIp >= OTP_MAX_PER_IP ||
      (latest && now - latest.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS)
    ) {
      throw new TooManyRequestsException();
    }

    const code = this.testCode ?? randomInt(0, 1_000_000).toString().padStart(6, '0');

    // A new code replaces any open one for the same phone and purpose.
    await this.prisma.$transaction([
      this.prisma.otpChallenge.updateMany({
        where: { phone: params.phone, purpose: params.purpose, consumedAt: null },
        data: { consumedAt: new Date(now) },
      }),
      this.prisma.otpChallenge.create({
        data: {
          phone: params.phone,
          purpose: params.purpose,
          codeHash: this.hash(params.purpose, params.phone, code),
          expiresAt: new Date(now + OTP_TTL_MS),
          requestIp: params.ip,
        },
      }),
    ]);

    if (params.deliver) {
      await this.notifications.sendSms({
        studioId: params.studioId,
        phone: params.phone,
        message: params.message(code),
        type: params.purpose === OtpPurpose.LOGIN ? 'LOGIN_OTP' : 'INVITE_OTP',
        sensitive: true,
      });
    }
  }

  /**
   * Consumes the open challenge if the code matches. Every wrong guess
   * counts; after OTP_MAX_ATTEMPTS the challenge is burned. Returns false
   * for any failure so callers can answer with one generic message.
   */
  async verify(phone: string, purpose: OtpPurpose, code: string): Promise<boolean> {
    const challenge = await this.prisma.otpChallenge.findFirst({
      where: { phone, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) return false;

    // Count the attempt before comparing so parallel guesses cannot exceed the limit.
    const counted = await this.prisma.otpChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null, attempts: { lt: OTP_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (counted.count === 0) return false;

    const expected = Buffer.from(challenge.codeHash, 'hex');
    const actual = Buffer.from(this.hash(purpose, phone, code), 'hex');
    const matches = expected.length === actual.length && timingSafeEqual(expected, actual);

    if (!matches) {
      if (challenge.attempts + 1 >= OTP_MAX_ATTEMPTS) {
        await this.prisma.otpChallenge.updateMany({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
      }
      return false;
    }

    // Single use: only one concurrent verifier can consume it.
    const consumed = await this.prisma.otpChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    return consumed.count === 1;
  }

  private hash(purpose: OtpPurpose, phone: string, code: string): string {
    return createHmac('sha256', this.key).update(`${purpose}:${phone}:${code}`).digest('hex');
  }
}
