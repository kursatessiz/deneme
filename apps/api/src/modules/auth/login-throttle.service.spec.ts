import type { RedisService } from '../redis/redis.service';
import { LOGIN_MAX_FAILURES_PER_IDENTIFIER, LOGIN_MAX_FAILURES_PER_IP, LoginThrottleService } from './login-throttle.service';

const make = () => new LoginThrottleService({ getClient: () => null } as unknown as RedisService);

describe('LoginThrottleService (in-memory)', () => {
  it('reserves attempts synchronously: a concurrent burst never gets more than the cap through', async () => {
    const throttle = make();
    const results = await Promise.allSettled(Array.from({ length: 100 }, () => throttle.reserveAttempt('mfa', 'user-1', '203.0.113.1')));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(LOGIN_MAX_FAILURES_PER_IDENTIFIER);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(100 - LOGIN_MAX_FAILURES_PER_IDENTIFIER);
  });

  it('a success clears the identifier budget and refunds the ip attempt', async () => {
    const throttle = make();
    for (let i = 0; i < LOGIN_MAX_FAILURES_PER_IDENTIFIER - 1; i += 1) await throttle.reserveAttempt('password', 'a@example.com', '203.0.113.2');
    await throttle.reserveAttempt('password', 'a@example.com', '203.0.113.2');
    await throttle.recordSuccess('password', 'a@example.com', '203.0.113.2');
    await expect(throttle.reserveAttempt('password', 'a@example.com', '203.0.113.2')).resolves.toBeUndefined();
  });

  it('successful sign-ins do not consume the per-ip budget', async () => {
    const throttle = make();
    for (let i = 0; i < LOGIN_MAX_FAILURES_PER_IP * 2; i += 1) {
      await throttle.reserveAttempt('password', `user-${i}`, '203.0.113.3');
      await throttle.recordSuccess('password', `user-${i}`, '203.0.113.3');
    }
    await expect(throttle.reserveAttempt('password', 'someone', '203.0.113.3')).resolves.toBeUndefined();
  });

  it('rejects when the ip budget is exhausted across identifiers', async () => {
    const throttle = make();
    for (let i = 0; i < LOGIN_MAX_FAILURES_PER_IP; i += 1) await throttle.reserveAttempt('password', `u-${i}`, '203.0.113.4');
    await expect(throttle.reserveAttempt('password', 'another', '203.0.113.4')).rejects.toMatchObject({ status: 429 });
  });
});
