import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { signTrackingToken, verifyTrackingToken } from './tracking-tokens';
import type { TrackingKind } from './tracking-tokens';

/**
 * Public tracking and unsubscribe URLs. Tokens are signed with the
 * dedicated MESSAGING_TRACKING_SECRET. Outside production a secret derived
 * from JWT_SECRET is used when it is unset (so local and test runs work);
 * in production, without the dedicated secret no tracking token is issued
 * and commercial email is refused (it could not carry an unsubscribe link).
 */
@Injectable()
export class MessagingUrls {
  constructor(private readonly config: ConfigService) {}

  secret(): string | null {
    const dedicated = this.config.get<string>('MESSAGING_TRACKING_SECRET');
    if (dedicated) return dedicated;
    if (this.config.get<string>('NODE_ENV') === 'production') return null;
    const jwt = this.config.get<string>('JWT_SECRET');
    return jwt ? createHmac('sha256', jwt).update('messaging-tracking-v1').digest('hex') : null;
  }

  sign(kind: TrackingKind, id: string): string | null {
    const secret = this.secret();
    return secret ? signTrackingToken(secret, kind, id) : null;
  }

  verify(token: string, kind: TrackingKind): string | null {
    const secret = this.secret();
    return secret ? verifyTrackingToken(secret, token, kind) : null;
  }

  private appUrl(): string {
    return this.config.get<string>('PUBLIC_APP_URL', 'http://localhost:3000').replace(/\/+$/, '');
  }

  private apiUrl(): string {
    return this.config.get<string>('PUBLIC_API_URL', 'http://localhost:4000').replace(/\/+$/, '');
  }

  /** 1x1 pixel, served by the API itself. */
  openPixelUrl(token: string): string {
    return `${this.apiUrl()}/m/o/${token}`;
  }

  /** Click redirect on the web app (it forwards the visitor cookie to the API). */
  clickUrl(token: string): string {
    return `${this.appUrl()}/m/c/${token}`;
  }

  /** Human unsubscribe page (web, tr + en). */
  unsubscribePageUrl(token: string): string {
    return `${this.appUrl()}/m/u/${token}`;
  }

  /** RFC 8058 one-click target for List-Unsubscribe (POST straight to the API). */
  unsubscribeOneClickUrl(token: string): string {
    return `${this.apiUrl()}/m/u/${token}`;
  }
}
