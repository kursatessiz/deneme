import type { SocialCredentials, SocialProvider } from '@platform/shared';

/**
 * How a failed publish call is treated by the heartbeat:
 * RETRYABLE (5xx, 429, network, provider rate limits) is retried with
 * backoff; PERMANENT (other 4xx: bad token, rejected content) ends in
 * FAILED with the reason; QUOTA_EXHAUSTED (Instagram 24 hour limit) leaves
 * the post SCHEDULED without spending a retry.
 */
export type SocialFailureKind = 'RETRYABLE' | 'PERMANENT' | 'QUOTA_EXHAUSTED';

export class SocialPublishError extends Error {
  constructor(
    readonly kind: SocialFailureKind,
    message: string,
    /** HTTP status of the provider answer, null for network failures and local decisions. */
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'SocialPublishError';
  }

  /** The credential itself is refused (expired, revoked): the connection should show an error. */
  get isAuthFailure(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

/** The account a call is made for: the provider's own id plus the decrypted credential. */
export interface SocialAccountRef {
  externalId: string;
  credentials: SocialCredentials;
}

export interface SocialPublishRequest extends SocialAccountRef {
  text: string;
  link: string | null;
  mediaUrls: readonly string[];
}

export interface SocialPublishResult {
  /** The id the network gave the new post. */
  externalPostId: string;
}

export interface SocialAccountInfo {
  displayName: string;
}

/** One organic publishing provider. Implementations only talk to their own allow-listed hosts through AdsHttpClient. */
export interface SocialPublisher {
  readonly provider: SocialProvider;
  /** Reads the account name with the credential (the connection test). */
  fetchAccount(account: SocialAccountRef): Promise<SocialAccountInfo>;
  /** Publishes now. Throws SocialPublishError for every failure. */
  publish(request: SocialPublishRequest): Promise<SocialPublishResult>;
}
