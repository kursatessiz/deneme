import type { ConfigService } from '@nestjs/config';
import type { CredentialCipher } from '../../../common/crypto/credential-cipher';
import type { PrismaService } from '../../prisma/prisma.service';
import type { RedisService } from '../../redis/redis.service';
import type { AuthService } from '../auth.service';
import { LOGIN_MAX_FAILURES_PER_IDENTIFIER, LoginThrottleService } from '../login-throttle.service';
import { MfaService } from './mfa.service';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function build() {
  let evaluated = 0;
  const prisma = {
    user: {
      findUniqueOrThrow: jest.fn(async () => {
        await delay(5);
        return { id: 'u1', mfaEnabledAt: new Date(), totpSecretEncrypted: 'enc', totpLastUsedStep: null };
      }),
    },
    userMfaRecoveryCode: {
      updateMany: jest.fn(async () => {
        evaluated += 1;
        await delay(5);
        return { count: 0 };
      }),
    },
  };
  const throttle = new LoginThrottleService({ getClient: () => null } as unknown as RedisService);
  const service = new MfaService(
    prisma as unknown as PrismaService,
    {} as unknown as CredentialCipher,
    {} as unknown as AuthService,
    throttle,
    {} as unknown as ConfigService,
  );
  return { service, evaluated: () => evaluated };
}

describe('MfaService.verify throttling', () => {
  it('evaluates at most the failure cap of wrong codes when requests arrive concurrently', async () => {
    const { service, evaluated } = build();
    const results = await Promise.allSettled(
      Array.from({ length: 200 }, (_, i) => service.verify('u1', { recoveryCode: `WRONG-${i}` }, '203.0.113.7')),
    );
    expect(evaluated()).toBeLessThanOrEqual(LOGIN_MAX_FAILURES_PER_IDENTIFIER);
    const statuses = results.map((r) => (r.status === 'rejected' ? (r.reason as { getStatus(): number }).getStatus() : 200));
    expect(statuses.filter((s) => s === 401)).toHaveLength(evaluated());
    expect(statuses.filter((s) => s === 429)).toHaveLength(200 - evaluated());
    expect(results.every((r) => r.status === 'rejected' && r.reason instanceof Error)).toBe(true);
  });
});
