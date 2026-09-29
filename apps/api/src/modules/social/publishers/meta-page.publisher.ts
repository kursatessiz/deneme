import { META_GRAPH_HOST, SOCIAL_META_API_VERSION, isVideoUrl, type SocialProvider } from '@platform/shared';
import type { AdsHttpClient, AdsHttpResponse } from '../../ads/ads-http-client';
import { SocialPublishError, type SocialAccountInfo, type SocialAccountRef, type SocialPublishRequest, type SocialPublishResult, type SocialPublisher } from '../social-publisher';
import { graphFailure, stringField, transportFailure } from './graph-errors';

const LABEL = 'Meta';

/**
 * Facebook Page post through the Graph API (`pages_manage_posts`): a text
 * (and link) post goes to /{page-id}/feed, a post with one image to
 * /{page-id}/photos and one with a video to /{page-id}/videos.
 */
export class MetaPagePublisher implements SocialPublisher {
  readonly provider: SocialProvider = 'META_PAGE';

  constructor(private readonly http: AdsHttpClient) {}

  private url(path: string): string {
    return `https://${META_GRAPH_HOST}/${SOCIAL_META_API_VERSION}/${path}`;
  }

  private headers(account: SocialAccountRef): Record<string, string> {
    return { authorization: `Bearer ${account.credentials.accessToken}` };
  }

  async fetchAccount(account: SocialAccountRef): Promise<SocialAccountInfo> {
    const secrets = [account.credentials.accessToken];
    let res: AdsHttpResponse;
    try {
      res = await this.http.getJson(this.provider, this.url(`${encodeURIComponent(account.externalId)}?fields=name`), this.headers(account));
    } catch (err) {
      throw transportFailure(LABEL, err, secrets);
    }
    if (!res.ok) throw graphFailure(LABEL, res, secrets);
    const name = stringField(res.body, 'name');
    if (!name) throw new SocialPublishError('PERMANENT', `${LABEL}: the answer carries no page name`, res.status);
    return { displayName: name };
  }

  async publish(request: SocialPublishRequest): Promise<SocialPublishResult> {
    const secrets = [request.credentials.accessToken];
    const page = encodeURIComponent(request.externalId);
    const media = request.mediaUrls[0];
    // Photos and videos have no link field: the link goes to the end of the caption.
    const caption = media && request.link ? `${request.text}\n${request.link}` : request.text;
    let path: string;
    let body: Record<string, string>;
    if (!media) {
      path = `${page}/feed`;
      body = { message: request.text, ...(request.link ? { link: request.link } : {}) };
    } else if (isVideoUrl(media)) {
      path = `${page}/videos`;
      body = { file_url: media, description: caption };
    } else {
      path = `${page}/photos`;
      body = { url: media, caption };
    }
    let res: AdsHttpResponse;
    try {
      res = await this.http.postJson(this.provider, this.url(path), this.headers(request), body);
    } catch (err) {
      throw transportFailure(LABEL, err, secrets);
    }
    if (!res.ok) throw graphFailure(LABEL, res, secrets);
    const id = stringField(res.body, 'post_id') ?? stringField(res.body, 'id');
    if (!id) throw new SocialPublishError('PERMANENT', `${LABEL}: the answer carries no post id`, res.status);
    return { externalPostId: id };
  }
}
