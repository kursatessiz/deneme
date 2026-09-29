import { INSTAGRAM_GRAPH_HOST, META_GRAPH_HOST, SOCIAL_META_API_VERSION, isVideoUrl, type SocialProvider } from '@platform/shared';
import type { AdsHttpClient, AdsHttpResponse } from '../../ads/ads-http-client';
import { SocialPublishError, type SocialAccountInfo, type SocialAccountRef, type SocialPublishRequest, type SocialPublishResult, type SocialPublisher } from '../social-publisher';
import { graphFailure, stringField, transportFailure } from './graph-errors';

const LABEL = 'Instagram';

/** Video containers are processed asynchronously: how often and how long to look before giving the call back to the retry schedule. */
const VIDEO_POLL_ATTEMPTS = 5;
const VIDEO_POLL_DELAY_MS = 2_000;

export type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Instagram content publishing (`instagram_content_publish`): the live
 * `content_publishing_limit` is read first and a used-up 24 hour quota is
 * refused (QUOTA_EXHAUSTED, the post stays scheduled); then a media
 * container is created and published (two steps). A token from Facebook
 * login calls graph.facebook.com, one from Instagram login
 * graph.instagram.com (credentials.apiHost).
 */
export class InstagramPublisher implements SocialPublisher {
  readonly provider: SocialProvider = 'INSTAGRAM';

  constructor(
    private readonly http: AdsHttpClient,
    private readonly sleep: Sleep = realSleep,
  ) {}

  private url(account: SocialAccountRef, path: string): string {
    const host = account.credentials.apiHost === INSTAGRAM_GRAPH_HOST ? INSTAGRAM_GRAPH_HOST : META_GRAPH_HOST;
    return `https://${host}/${SOCIAL_META_API_VERSION}/${path}`;
  }

  private headers(account: SocialAccountRef): Record<string, string> {
    return { authorization: `Bearer ${account.credentials.accessToken}` };
  }

  private async get(account: SocialAccountRef, path: string): Promise<AdsHttpResponse> {
    try {
      return await this.http.getJson(this.provider, this.url(account, path), this.headers(account));
    } catch (err) {
      throw transportFailure(LABEL, err, [account.credentials.accessToken]);
    }
  }

  private async post(account: SocialAccountRef, path: string, body: Record<string, string>): Promise<AdsHttpResponse> {
    try {
      return await this.http.postJson(this.provider, this.url(account, path), this.headers(account), body);
    } catch (err) {
      throw transportFailure(LABEL, err, [account.credentials.accessToken]);
    }
  }

  async fetchAccount(account: SocialAccountRef): Promise<SocialAccountInfo> {
    const res = await this.get(account, `${encodeURIComponent(account.externalId)}?fields=username,name`);
    if (!res.ok) throw graphFailure(LABEL, res, [account.credentials.accessToken]);
    const name = stringField(res.body, 'username') ?? stringField(res.body, 'name');
    if (!name) throw new SocialPublishError('PERMANENT', `${LABEL}: the answer carries no account name`, res.status);
    return { displayName: name };
  }

  /** Throws QUOTA_EXHAUSTED when the account has used its whole 24 hour quota. */
  private async assertQuota(account: SocialAccountRef): Promise<void> {
    const res = await this.get(account, `${encodeURIComponent(account.externalId)}/content_publishing_limit?fields=quota_usage,config`);
    if (!res.ok) throw graphFailure(LABEL, res, [account.credentials.accessToken]);
    const rows = res.body && typeof res.body === 'object' ? (res.body as { data?: unknown }).data : null;
    const row = Array.isArray(rows) ? (rows[0] as { quota_usage?: unknown; config?: { quota_total?: unknown } } | undefined) : undefined;
    const usage = typeof row?.quota_usage === 'number' ? row.quota_usage : null;
    const total = typeof row?.config?.quota_total === 'number' ? row.config.quota_total : null;
    if (usage === null || total === null) throw new SocialPublishError('RETRYABLE', `${LABEL}: the publishing limit could not be read`, res.status);
    if (usage >= total) throw new SocialPublishError('QUOTA_EXHAUSTED', `${LABEL}: the 24 hour publishing limit is used up (${usage}/${total})`, null);
  }

  private async waitForContainer(account: SocialAccountRef, containerId: string): Promise<void> {
    for (let attempt = 0; attempt < VIDEO_POLL_ATTEMPTS; attempt += 1) {
      const res = await this.get(account, `${encodeURIComponent(containerId)}?fields=status_code`);
      if (!res.ok) throw graphFailure(LABEL, res, [account.credentials.accessToken]);
      const status = stringField(res.body, 'status_code');
      if (status === 'FINISHED') return;
      if (status === 'ERROR' || status === 'EXPIRED') throw new SocialPublishError('PERMANENT', `${LABEL}: the media container ended in ${status}`, res.status);
      await this.sleep(VIDEO_POLL_DELAY_MS);
    }
    throw new SocialPublishError('RETRYABLE', `${LABEL}: the video is still being processed`, null);
  }

  async publish(request: SocialPublishRequest): Promise<SocialPublishResult> {
    const media = request.mediaUrls[0];
    if (!media) throw new SocialPublishError('PERMANENT', `${LABEL}: a post needs an image or video`, null);
    await this.assertQuota(request);

    const caption = request.link ? `${request.text}\n${request.link}` : request.text;
    const video = isVideoUrl(media);
    const container = await this.post(request, `${encodeURIComponent(request.externalId)}/media`, {
      caption,
      ...(video ? { media_type: 'REELS', video_url: media } : { image_url: media }),
    });
    if (!container.ok) throw graphFailure(LABEL, container, [request.credentials.accessToken]);
    const creationId = stringField(container.body, 'id');
    if (!creationId) throw new SocialPublishError('PERMANENT', `${LABEL}: the container answer carries no id`, container.status);
    if (video) await this.waitForContainer(request, creationId);

    const published = await this.post(request, `${encodeURIComponent(request.externalId)}/media_publish`, { creation_id: creationId });
    if (!published.ok) throw graphFailure(LABEL, published, [request.credentials.accessToken]);
    const id = stringField(published.body, 'id');
    if (!id) throw new SocialPublishError('PERMANENT', `${LABEL}: the publish answer carries no id`, published.status);
    return { externalPostId: id };
  }
}
