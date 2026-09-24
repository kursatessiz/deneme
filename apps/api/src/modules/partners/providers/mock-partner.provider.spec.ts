import { MockPartnerProvider } from './mock-partner.provider';
import type { PartnerConnectionCredentials } from '@platform/shared';

describe('MockPartnerProvider.verifyWebhookSignature', () => {
  const provider = new MockPartnerProvider();
  const credentials: PartnerConnectionCredentials = { webhookSecret: 'whsec_test_123' };
  const now = new Date('2026-01-01T12:00:00Z');
  const timestamp = now.toISOString();
  const rawBody = JSON.stringify({ eventId: 'evt_1', eventType: 'RESERVATION_CREATED' });

  it('accepts a correctly signed, fresh payload', () => {
    const signature = MockPartnerProvider.sign(credentials.webhookSecret, timestamp, rawBody);
    const result = provider.verifyWebhookSignature(credentials, rawBody, signature, timestamp, now);
    expect(result.valid).toBe(true);
  });

  it('rejects a tampered body (signature no longer matches)', () => {
    const signature = MockPartnerProvider.sign(credentials.webhookSecret, timestamp, rawBody);
    const tamperedBody = JSON.stringify({ eventId: 'evt_1', eventType: 'RESERVATION_CANCELLED' });
    const result = provider.verifyWebhookSignature(credentials, tamperedBody, signature, timestamp, now);
    expect(result.valid).toBe(false);
  });

  it('rejects a signature computed with the wrong secret', () => {
    const signature = MockPartnerProvider.sign('wrong-secret', timestamp, rawBody);
    const result = provider.verifyWebhookSignature(credentials, rawBody, signature, timestamp, now);
    expect(result.valid).toBe(false);
  });

  it('rejects a timestamp outside the 5 minute tolerance (expired)', () => {
    const oldTimestamp = new Date(now.getTime() - 6 * 60 * 1000).toISOString();
    const signature = MockPartnerProvider.sign(credentials.webhookSecret, oldTimestamp, rawBody);
    const result = provider.verifyWebhookSignature(credentials, rawBody, signature, oldTimestamp, now);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/tolerance/);
  });

  it('accepts a timestamp just inside the tolerance window', () => {
    const nearTimestamp = new Date(now.getTime() - 4 * 60 * 1000).toISOString();
    const signature = MockPartnerProvider.sign(credentials.webhookSecret, nearTimestamp, rawBody);
    const result = provider.verifyWebhookSignature(credentials, rawBody, signature, nearTimestamp, now);
    expect(result.valid).toBe(true);
  });

  it('rejects a missing signature header', () => {
    const result = provider.verifyWebhookSignature(credentials, rawBody, undefined, timestamp, now);
    expect(result.valid).toBe(false);
  });

  it('rejects a missing timestamp header', () => {
    const signature = MockPartnerProvider.sign(credentials.webhookSecret, timestamp, rawBody);
    const result = provider.verifyWebhookSignature(credentials, rawBody, signature, undefined, now);
    expect(result.valid).toBe(false);
  });

  it('rejects an unparsable timestamp', () => {
    const result = provider.verifyWebhookSignature(credentials, rawBody, 'deadbeef', 'not-a-date', now);
    expect(result.valid).toBe(false);
  });
});
