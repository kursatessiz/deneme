import { WEBHOOK_MAX_ATTEMPTS, WEBHOOK_RETRY_DELAYS_SECONDS, webhookBackoffSeconds } from '@platform/shared';

describe('webhook backoff schedule', () => {
  it('has 6 attempts total, growing and bounded', () => {
    expect(WEBHOOK_MAX_ATTEMPTS).toBe(6);
    expect(WEBHOOK_RETRY_DELAYS_SECONDS).toEqual([0, 30, 120, 600, 1800, 3600]);
  });

  it('the first attempt has no delay', () => {
    expect(webhookBackoffSeconds(1)).toBe(0);
  });

  it('delays strictly increase with each retry', () => {
    const delays = [1, 2, 3, 4, 5, 6].map(webhookBackoffSeconds);
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThan(delays[i - 1]);
    }
  });

  it('clamps out-of-range attempt numbers to the schedule bounds', () => {
    expect(webhookBackoffSeconds(0)).toBe(webhookBackoffSeconds(1));
    expect(webhookBackoffSeconds(99)).toBe(webhookBackoffSeconds(WEBHOOK_MAX_ATTEMPTS));
  });
});
