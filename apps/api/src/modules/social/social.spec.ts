import { AdsHttpClient, type AdsHttpResponse, type OutboundScope } from '../ads/ads-http-client';
import { FakeSocialPublisher } from './publishers/fake.publisher';
import { InstagramPublisher } from './publishers/instagram.publisher';
import { LinkedInOrgPublisher } from './publishers/linkedin-org.publisher';
import { MetaPagePublisher } from './publishers/meta-page.publisher';
import { sanitizeProviderMessage } from './publishers/graph-errors';
import { socialPostContentHash } from './social-content-hash';
import { SocialPublishError } from './social-publisher';

interface Call {
  method: 'GET' | 'POST';
  scope: OutboundScope;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}

/** Scripted stand-in for AdsHttpClient: answers are consumed in order, every call is recorded. */
class ScriptedHttp {
  readonly calls: Call[] = [];
  constructor(private readonly answers: Array<AdsHttpResponse | Error>) {}

  private next(): AdsHttpResponse {
    const answer = this.answers.shift();
    if (!answer) throw new Error('no scripted answer left');
    if (answer instanceof Error) throw answer;
    return answer;
  }

  async getJson(scope: OutboundScope, url: string, headers: Record<string, string>): Promise<AdsHttpResponse> {
    this.calls.push({ method: 'GET', scope, url, headers });
    return this.next();
  }

  async postJson(scope: OutboundScope, url: string, headers: Record<string, string>, body: unknown): Promise<AdsHttpResponse> {
    this.calls.push({ method: 'POST', scope, url, headers, body });
    return this.next();
  }

  asClient(): AdsHttpClient {
    return this as unknown as AdsHttpClient;
  }
}

const ok = (body: unknown, headers?: Record<string, string>): AdsHttpResponse => ({ ok: true, status: 200, body, headers });
const fail = (status: number, body: unknown): AdsHttpResponse => ({ ok: false, status, body });
const account = { externalId: '1784140000', credentials: { accessToken: 'EAAB-secret-token-9999' } };
const request = { ...account, text: 'Merhaba dunya', link: null as string | null, mediaUrls: [] as string[] };

async function failureOf(promise: Promise<unknown>): Promise<SocialPublishError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof SocialPublishError) return err;
    throw err;
  }
  throw new Error('expected a SocialPublishError');
}

describe('socialPostContentHash', () => {
  const base = { connectionId: 'c1', text: 'Merhaba', mediaUrls: ['https://a.io/1.jpg'], link: 'https://a.io/?utm=1', scheduledAt: '2026-10-01T09:00:00.000Z' };

  it('is stable and bound to account, text, media, link and time', () => {
    const hash = socialPostContentHash(base);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(socialPostContentHash({ ...base })).toBe(hash);
    expect(socialPostContentHash({ ...base, scheduledAt: '2026-10-01T11:00:00+02:00' })).toBe(hash);
    expect(socialPostContentHash({ ...base, connectionId: 'c2' })).not.toBe(hash);
    expect(socialPostContentHash({ ...base, text: 'Merhaba!' })).not.toBe(hash);
    expect(socialPostContentHash({ ...base, mediaUrls: [] })).not.toBe(hash);
    expect(socialPostContentHash({ ...base, link: null })).not.toBe(hash);
    expect(socialPostContentHash({ ...base, scheduledAt: '2026-10-01T09:00:01.000Z' })).not.toBe(hash);
    expect(socialPostContentHash({ ...base, scheduledAt: null })).not.toBe(hash);
  });
});

describe('outbound allow-list', () => {
  const client = new AdsHttpClient();
  const assertAllowed = (scope: OutboundScope, url: string) => (client as unknown as { assertAllowedHost(s: OutboundScope, u: string): void }).assertAllowedHost(scope, url);

  it('allows each social provider its own hosts only', () => {
    expect(() => assertAllowed('META_PAGE', 'https://graph.facebook.com/v21.0/1/feed')).not.toThrow();
    expect(() => assertAllowed('INSTAGRAM', 'https://graph.instagram.com/v21.0/1/media')).not.toThrow();
    expect(() => assertAllowed('LINKEDIN_ORG', 'https://api.linkedin.com/rest/posts')).not.toThrow();
    expect(() => assertAllowed('META_PAGE', 'https://graph.instagram.com/v21.0/1/media')).toThrow();
    expect(() => assertAllowed('LINKEDIN_ORG', 'https://graph.facebook.com/x')).toThrow();
    expect(() => assertAllowed('INSTAGRAM', 'https://evil.example.com/x')).toThrow();
  });

  it('keeps the ad platform lists as they were', () => {
    expect(() => assertAllowed('META', 'https://graph.facebook.com/v21.0/1/events')).not.toThrow();
    expect(() => assertAllowed('GOOGLE', 'https://graph.facebook.com/x')).toThrow();
  });
});

describe('MetaPagePublisher', () => {
  it('posts text and link to the page feed with a bearer header and no token in the URL', async () => {
    const http = new ScriptedHttp([ok({ id: '123_456' })]);
    const result = await new MetaPagePublisher(http.asClient()).publish({ ...request, link: 'https://example.com/?utm_source=fb' });
    expect(result.externalPostId).toBe('123_456');
    expect(http.calls[0]).toMatchObject({
      method: 'POST',
      scope: 'META_PAGE',
      url: 'https://graph.facebook.com/v21.0/1784140000/feed',
      headers: { authorization: 'Bearer EAAB-secret-token-9999' },
      body: { message: 'Merhaba dunya', link: 'https://example.com/?utm_source=fb' },
    });
    expect(http.calls[0].url).not.toContain('EAAB');
  });

  it('uses /photos for one image and /videos for a video, with the link in the caption', async () => {
    const photo = new ScriptedHttp([ok({ id: '1', post_id: '123_789' })]);
    const publisher = new MetaPagePublisher(photo.asClient());
    expect((await publisher.publish({ ...request, mediaUrls: ['https://a.io/p.jpg'], link: 'https://a.io' })).externalPostId).toBe('123_789');
    expect(photo.calls[0].url).toBe('https://graph.facebook.com/v21.0/1784140000/photos');
    expect(photo.calls[0].body).toEqual({ url: 'https://a.io/p.jpg', caption: 'Merhaba dunya\nhttps://a.io' });
    const video = new ScriptedHttp([ok({ id: 'v1' })]);
    await new MetaPagePublisher(video.asClient()).publish({ ...request, mediaUrls: ['https://a.io/c.mp4'] });
    expect(video.calls[0].url).toBe('https://graph.facebook.com/v21.0/1784140000/videos');
  });

  it('reads the page name for the connection test', async () => {
    const http = new ScriptedHttp([ok({ name: 'Marka Sayfasi' })]);
    expect(await new MetaPagePublisher(http.asClient()).fetchAccount(account)).toEqual({ displayName: 'Marka Sayfasi' });
  });

  it('retries 429, 5xx and Graph rate limit codes; fails other 4xx for good; never echoes the token', async () => {
    const kinds = async (answer: AdsHttpResponse | Error) => (await failureOf(new MetaPagePublisher(new ScriptedHttp([answer]).asClient()).publish(request))).kind;
    expect(await kinds(fail(429, {}))).toBe('RETRYABLE');
    expect(await kinds(fail(503, {}))).toBe('RETRYABLE');
    expect(await kinds(fail(400, { error: { code: 4, message: 'Application request limit reached' } }))).toBe('RETRYABLE');
    expect(await kinds(fail(400, { error: { code: 100, message: 'Invalid parameter', is_transient: true } }))).toBe('RETRYABLE');
    expect(await kinds(new Error('fetch failed'))).toBe('RETRYABLE');
    expect(await kinds(fail(400, { error: { code: 100, message: 'Invalid parameter' } }))).toBe('PERMANENT');
    const auth = await failureOf(new MetaPagePublisher(new ScriptedHttp([fail(401, { error: { code: 190, message: 'Invalid OAuth access token EAAB-secret-token-9999' } })]).asClient()).publish(request));
    expect(auth.kind).toBe('PERMANENT');
    expect(auth.isAuthFailure).toBe(true);
    expect(auth.message).not.toContain('EAAB-secret-token-9999');
    expect(auth.message).toContain('[redacted]');
  });
});

describe('InstagramPublisher', () => {
  const quota = (usage: number, total = 100) => ok({ data: [{ quota_usage: usage, config: { quota_total: total, quota_duration: 86400 } }] });
  const media = ['https://a.io/p.jpg'];

  it('reads the live quota, then creates the container and publishes it', async () => {
    const http = new ScriptedHttp([quota(3), ok({ id: 'container-1' }), ok({ id: 'ig-post-1' })]);
    const result = await new InstagramPublisher(http.asClient()).publish({ ...request, mediaUrls: media, link: 'https://a.io' });
    expect(result.externalPostId).toBe('ig-post-1');
    expect(http.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET https://graph.facebook.com/v21.0/1784140000/content_publishing_limit?fields=quota_usage,config',
      'POST https://graph.facebook.com/v21.0/1784140000/media',
      'POST https://graph.facebook.com/v21.0/1784140000/media_publish',
    ]);
    expect(http.calls[1].body).toEqual({ caption: 'Merhaba dunya\nhttps://a.io', image_url: 'https://a.io/p.jpg' });
    expect(http.calls[2].body).toEqual({ creation_id: 'container-1' });
  });

  it('refuses with QUOTA_EXHAUSTED when the 24 hour quota is used up, before creating any container', async () => {
    const http = new ScriptedHttp([quota(100)]);
    const err = await failureOf(new InstagramPublisher(http.asClient()).publish({ ...request, mediaUrls: media }));
    expect(err.kind).toBe('QUOTA_EXHAUSTED');
    expect(http.calls).toHaveLength(1);
  });

  it('uses graph.instagram.com for an Instagram login token', async () => {
    const http = new ScriptedHttp([quota(0), ok({ id: 'c' }), ok({ id: 'p' })]);
    await new InstagramPublisher(http.asClient()).publish({ ...request, credentials: { ...request.credentials, apiHost: 'graph.instagram.com' }, mediaUrls: media });
    expect(http.calls.every((c) => c.url.startsWith('https://graph.instagram.com/'))).toBe(true);
  });

  it('waits for a video container to finish and treats an unreadable quota as retryable', async () => {
    const sleeps: number[] = [];
    const http = new ScriptedHttp([quota(0), ok({ id: 'c' }), ok({ status_code: 'IN_PROGRESS' }), ok({ status_code: 'FINISHED' }), ok({ id: 'reel-1' })]);
    const publisher = new InstagramPublisher(http.asClient(), async (ms) => void sleeps.push(ms));
    expect((await publisher.publish({ ...request, mediaUrls: ['https://a.io/c.mp4'] })).externalPostId).toBe('reel-1');
    expect(http.calls[1].body).toMatchObject({ media_type: 'REELS', video_url: 'https://a.io/c.mp4' });
    expect(sleeps).toHaveLength(1);
    const unreadable = await failureOf(new InstagramPublisher(new ScriptedHttp([ok({ data: [] })]).asClient()).publish({ ...request, mediaUrls: media }));
    expect(unreadable.kind).toBe('RETRYABLE');
  });

  it('refuses a post without media', async () => {
    const err = await failureOf(new InstagramPublisher(new ScriptedHttp([]).asClient()).publish(request));
    expect(err.kind).toBe('PERMANENT');
  });
});

describe('LinkedInOrgPublisher', () => {
  it('posts to /rest/posts with the versioned headers and reads the id from x-restli-id', async () => {
    const http = new ScriptedHttp([{ ok: true, status: 201, body: null, headers: { 'x-restli-id': 'urn:li:share:7001' } }]);
    const result = await new LinkedInOrgPublisher(http.asClient()).publish({ ...request, link: 'https://example.com/a' });
    expect(result.externalPostId).toBe('urn:li:share:7001');
    const call = http.calls[0];
    expect(call.url).toBe('https://api.linkedin.com/rest/posts');
    expect(call.headers).toMatchObject({ authorization: 'Bearer EAAB-secret-token-9999', 'linkedin-version': '202405', 'x-restli-protocol-version': '2.0.0' });
    expect(call.body).toMatchObject({ author: 'urn:li:organization:1784140000', commentary: 'Merhaba dunya', lifecycleState: 'PUBLISHED', content: { article: { source: 'https://example.com/a' } } });
  });

  it('classifies 429 and 5xx as retryable and 4xx as permanent', async () => {
    const kind = async (status: number) => (await failureOf(new LinkedInOrgPublisher(new ScriptedHttp([fail(status, { message: 'nope' })]).asClient()).publish(request))).kind;
    expect(await kind(429)).toBe('RETRYABLE');
    expect(await kind(502)).toBe('RETRYABLE');
    expect(await kind(422)).toBe('PERMANENT');
  });
});

describe('FakeSocialPublisher', () => {
  it('succeeds with a stable id and simulates failures by token', async () => {
    const fake = new FakeSocialPublisher('META_PAGE');
    const a = await fake.publish(request);
    expect(a.externalPostId).toBe((await fake.publish(request)).externalPostId);
    expect((await failureOf(fake.publish({ ...request, credentials: { accessToken: 'FAKE_QUOTA_x' } }))).kind).toBe('QUOTA_EXHAUSTED');
    expect((await failureOf(fake.publish({ ...request, credentials: { accessToken: 'FAKE_5XX_xx' } }))).kind).toBe('RETRYABLE');
    expect((await failureOf(fake.publish({ ...request, credentials: { accessToken: 'FAKE_4XX_xx' } }))).kind).toBe('PERMANENT');
  });
});

describe('sanitizeProviderMessage', () => {
  it('redacts secrets, collapses whitespace and truncates', () => {
    expect(sanitizeProviderMessage('bad  token\nabc123456 here', ['abc123456'])).toBe('bad token [redacted] here');
    expect(sanitizeProviderMessage('x'.repeat(400), [])).toHaveLength(303);
  });
});
