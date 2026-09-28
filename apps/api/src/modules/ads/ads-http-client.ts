import { Injectable } from '@nestjs/common';
import { AD_PLATFORM_ALLOWED_HOSTS } from '@platform/shared';
import type { AdConnectionPlatform } from '@platform/shared';

export interface AdsHttpResponse {
  ok: boolean;
  status: number;
  body: unknown;
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

  async postJson(platform: AdConnectionPlatform, url: string, headers: Record<string, string>, body: unknown): Promise<AdsHttpResponse> {
    this.assertAllowedHost(platform, url);
    return this.send(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  }

  async getJson(platform: AdConnectionPlatform, url: string, headers: Record<string, string>): Promise<AdsHttpResponse> {
    this.assertAllowedHost(platform, url);
    return this.send(url, { method: 'GET', headers });
  }

  private assertAllowedHost(platform: AdConnectionPlatform, url: string): void {
    const host = new URL(url).hostname;
    if (!AD_PLATFORM_ALLOWED_HOSTS[platform].includes(host)) {
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
      return { ok: res.ok, status: res.status, body: json };
    } finally {
      clearTimeout(timer);
    }
  }
}
