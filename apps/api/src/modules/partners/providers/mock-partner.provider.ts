import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { PartnerProvider } from '@platform/database';
import type { PartnerConnectionCredentials } from '@platform/shared';
import type {
  PartnerProviderAdapter,
  PushAvailabilityParams,
  PushAvailabilityResult,
  WebhookVerificationResult,
} from './partner-provider.interface';

const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * Deterministic in-process partner adapter used by default and in tests. No
 * network calls: pushAvailability just records that it was called (tests
 * assert on the call log) and always succeeds. Implements the same
 * HMAC-SHA256 signature scheme real providers are expected to use, so the
 * webhook controller's verification path is fully exercised without a real
 * contract.
 */
@Injectable()
export class MockPartnerProvider implements PartnerProviderAdapter {
  readonly name = PartnerProvider.MOCK;

  readonly calls: PushAvailabilityParams[] = [];

  async pushAvailability(
    _credentials: PartnerConnectionCredentials,
    params: PushAvailabilityParams,
  ): Promise<PushAvailabilityResult> {
    this.calls.push(params);
    return { success: true };
  }

  verifyWebhookSignature(
    credentials: PartnerConnectionCredentials,
    rawBody: string,
    signatureHeader: string | undefined,
    timestampHeader: string | undefined,
    now: Date,
  ): WebhookVerificationResult {
    if (!signatureHeader) return { valid: false, reason: 'missing signature' };
    if (!timestampHeader) return { valid: false, reason: 'missing timestamp' };

    const timestampMs = Date.parse(timestampHeader);
    if (Number.isNaN(timestampMs)) return { valid: false, reason: 'invalid timestamp' };
    if (Math.abs(now.getTime() - timestampMs) > TIMESTAMP_TOLERANCE_MS) {
      return { valid: false, reason: 'timestamp outside tolerance' };
    }

    const expected = MockPartnerProvider.sign(credentials.webhookSecret, timestampHeader, rawBody);
    const expectedBuf = Buffer.from(expected, 'hex');
    const actualBuf = Buffer.from(signatureHeader, 'hex');
    if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
      return { valid: false, reason: 'signature mismatch' };
    }
    return { valid: true };
  }

  /** Test helper mirroring how a real partner would sign a webhook delivery. */
  static sign(webhookSecret: string, timestamp: string, rawBody: string): string {
    return createHmac('sha256', webhookSecret).update(`${timestamp}.${rawBody}`).digest('hex');
  }
}
