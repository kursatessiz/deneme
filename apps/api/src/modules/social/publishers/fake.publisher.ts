import { createHash } from 'crypto';
import type { SocialProvider } from '@platform/shared';
import { SocialPublishError, type SocialAccountInfo, type SocialAccountRef, type SocialPublishRequest, type SocialPublishResult, type SocialPublisher } from '../social-publisher';

/**
 * Deterministic publisher for the automated suites only
 * (SOCIAL_FAKE_PROVIDER=1; env.ts refuses it in production and the registry
 * is the second lock). It never touches the network. The pasted token picks
 * the behaviour: FAKE_QUOTA (Instagram quota used up), FAKE_5XX (retryable
 * provider error), FAKE_4XX (permanent rejection); anything else succeeds
 * with a stable post id.
 */
export class FakeSocialPublisher implements SocialPublisher {
  constructor(readonly provider: SocialProvider) {}

  async fetchAccount(account: SocialAccountRef): Promise<SocialAccountInfo> {
    if (account.credentials.accessToken.includes('FAKE_4XX')) throw new SocialPublishError('PERMANENT', 'Fake 401: invalid token', 401);
    return { displayName: `Fake ${this.provider} ${account.externalId}` };
  }

  async publish(request: SocialPublishRequest): Promise<SocialPublishResult> {
    const token = request.credentials.accessToken;
    if (token.includes('FAKE_QUOTA')) throw new SocialPublishError('QUOTA_EXHAUSTED', 'Fake: the 24 hour publishing limit is used up', null);
    if (token.includes('FAKE_5XX')) throw new SocialPublishError('RETRYABLE', 'Fake 503: temporarily unavailable', 503);
    if (token.includes('FAKE_4XX')) throw new SocialPublishError('PERMANENT', 'Fake 400: the content was rejected', 400);
    const digest = createHash('sha1').update(`${this.provider}:${request.externalId}:${request.text}`).digest('hex').slice(0, 12);
    return { externalPostId: `fake_${this.provider.toLowerCase()}_${digest}` };
  }
}
