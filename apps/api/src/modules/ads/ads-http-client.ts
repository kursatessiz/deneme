import { Injectable } from '@nestjs/common';
import { AD_PLATFORM_ALLOWED_HOSTS, OAUTH_PROVIDER_ALLOWED_HOSTS, SOCIAL_PROVIDER_ALLOWED_HOSTS } from '@platform/shared';
import type { AdConnectionPlatform, OAuthProvider, SocialProvider } from '@platform/shared';

/** OAuth token and identity calls of a provider (M4a); prefixed so 'META' / 'GOOGLE' never mean the ad platform lists. */
export type OAuthOutboundScope = `oauth:${OAuthProvider}`;

/** Which allow-list applies: an ad platform (conversions, spend), a social provider (organic publishing, M4b) or an OAuth provider (M4a). */
export type OutboundScope = AdConnectionPlatform | SocialProvider | OAuthOutboundScope;

export interface AdsHttpResponse {
  ok: boolean;
  status: number;
  body: unknown;
  /** Response headers, lower-cased names (LinkedIn returns the new post id in x-restli-id). Absent in older test doubles. */
  headers?: Readonly<Record<string, string>>;
}

/** The fixed hosts of a scope; a name in neither list has none. */
function allowedHostsOf(scope: OutboundScope): readonly string[] {
  if (scope.startsWith('oauth:')) {
    const provider = scope.slice('oauth:'.length);
    return Object.prototype.hasOwnProperty.call(OAUTH_PROVIDER_ALLOWED_HOSTS, provider) ? OAUTH_PROVIDER_ALLOWED_HOSTS[provider as OAuthProvider] : [];
  }
  if (Object.prototype.hasOwnProperty.call(AD_PLATFORM_ALLOWED_HOSTS, scope)) return AD_PLATFORM_ALLOWED_HOSTS[scope as AdConnectionPlatform];
  return SOCIAL_PROVIDER_ALLOWED_HOSTS[scope as SocialProvider] ?? [];
}

/**
 * The only way any ad adapter reaches the network. Every URL is checked
 * against the platform's fixed allow-list (rule 7: outbound HTTP only to
 * the fixed platform hosts) before the request is sent, and this is the
 * single seam the e2e suite mocks so tests never call a real ad platform.
 */
@Injectable()
export class AdsHttpClient {
  private readonly timeoutMs = 8000;

  async postJson(platform: OutboundScope, url: string, headers: Record<string, string>, body: unknown): Promise<AdsHttpResponse> {
    this.assertAllowedHost(platform, url);
    return this.send(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  }

  /** application/x-www-form-urlencoded POST (OAuth token endpoints); secrets travel in the body, never in the URL. */
  async postForm(platform: OutboundScope, url: string, headers: Record<string, string>, form: Record<string, string>): Promise<AdsHttpResponse> {
    this.assertAllowedHost(platform, url);
    return this.send(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', ...headers },
      body: new URLSearchParams(form).toString(),
    });
  }

  async getJson(platform: OutboundScope, url: string, headers: Record<string, string>): Promise<AdsHttpResponse> {
    this.assertAllowedHost(platform, url);
    return this.send(url, { method: 'GET', headers });
  }

  private assertAllowedHost(platform: OutboundScope, url: string): void {
    const host = new URL(url).hostname;
    if (!allowedHostsOf(platform).includes(host)) {
      throw new Error(`Reklam platformu için izin verilmeyen host: ${host}`);
    }
  }

  private async send(url: string, init: RequestInit): Promise<AdsHttpResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = text;
      }
      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
      return { ok: res.ok, status: res.status, body: json, headers };
    } finally {
      clearTimeout(timer);
    }
  }
}
