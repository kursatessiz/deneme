import { LINKEDIN_API_HOST, SOCIAL_LINKEDIN_API_VERSION, type SocialProvider } from '@platform/shared';
import type { AdsHttpClient, AdsHttpResponse } from '../../ads/ads-http-client';
import { SocialPublishError, type SocialAccountInfo, type SocialAccountRef, type SocialPublishRequest, type SocialPublishResult, type SocialPublisher } from '../social-publisher';
import { sanitizeProviderMessage, stringField, transportFailure } from './graph-errors';

const LABEL = 'LinkedIn';

/**
 * LinkedIn organization post through the Community Management API
 * (`w_organization_social`, POST /rest/posts with the versioned headers).
 * A link becomes an article share; images and videos need LinkedIn's own
 * upload flow and are not part of M4b (the network limits say maxMedia 0).
 */
export class LinkedInOrgPublisher implements SocialPublisher {
  readonly provider: SocialProvider = 'LINKEDIN_ORG';

  constructor(private readonly http: AdsHttpClient) {}

  private url(path: string): string {
    return `https://${LINKEDIN_API_HOST}/rest/${path}`;
  }

  private headers(account: SocialAccountRef): Record<string, string> {
    return {
      authorization: `Bearer ${account.credentials.accessToken}`,
      'linkedin-version': SOCIAL_LINKEDIN_API_VERSION,
      'x-restli-protocol-version': '2.0.0',
    };
  }

  private failure(res: AdsHttpResponse, secrets: readonly string[]): SocialPublishError {
    const message = stringField(res.body, 'message') ?? `HTTP ${res.status}`;
    const retryable = res.status === 429 || res.status >= 500;
    return new SocialPublishError(retryable ? 'RETRYABLE' : 'PERMANENT', `${LABEL} ${res.status}: ${sanitizeProviderMessage(message, secrets)}`, res.status);
  }

  async fetchAccount(account: SocialAccountRef): Promise<SocialAccountInfo> {
    const secrets = [account.credentials.accessToken];
    let res: AdsHttpResponse;
    try {
      res = await this.http.getJson(this.provider, this.url(`organizations/${encodeURIComponent(account.externalId)}`), this.headers(account));
    } catch (err) {
      throw transportFailure(LABEL, err, secrets);
    }
    if (!res.ok) throw this.failure(res, secrets);
    const name = stringField(res.body, 'localizedName') ?? stringField(res.body, 'vanityName');
    if (!name) throw new SocialPublishError('PERMANENT', `${LABEL}: the answer carries no organization name`, res.status);
    return { displayName: name };
  }

  async publish(request: SocialPublishRequest): Promise<SocialPublishResult> {
    const secrets = [request.credentials.accessToken];
    const body = {
      author: `urn:li:organization:${request.externalId}`,
      commentary: request.text,
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
      ...(request.link ? { content: { article: { source: request.link } } } : {}),
    };
    let res: AdsHttpResponse;
    try {
      res = await this.http.postJson(this.provider, this.url('posts'), this.headers(request), body);
    } catch (err) {
      throw transportFailure(LABEL, err, secrets);
    }
    if (!res.ok) throw this.failure(res, secrets);
    // LinkedIn answers 201 with the new post URN in the x-restli-id header and an empty body.
    const id = res.headers?.['x-restli-id'] ?? stringField(res.body, 'id');
    if (!id) throw new SocialPublishError('PERMANENT', `${LABEL}: the answer carries no post id`, res.status);
    return { externalPostId: id };
  }
}
