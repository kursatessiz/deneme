import { createVerify } from 'crypto';

/**
 * Amazon SNS message signature verification (SES bounce, complaint and
 * delivery notifications arrive through SNS). Implements AWS's documented
 * scheme: rebuild the canonical string from the message fields, fetch the
 * signing certificate only from an https://sns.<region>.amazonaws.com URL
 * ending in .pem, and verify the base64 signature with SHA1
 * (SignatureVersion 1) or SHA256 (SignatureVersion 2).
 */

export interface SnsEnvelope {
  Type: string;
  MessageId: string;
  TopicArn: string;
  Subject?: string | null;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  SubscribeURL?: string;
  Token?: string;
  UnsubscribeURL?: string;
}

export type SnsCertFetcher = (url: string) => Promise<string>;

/** Injection token for the certificate fetcher (tests swap in a local key). */
export const SNS_CERT_FETCHER = Symbol('SNS_CERT_FETCHER');

const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;

function isString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/** Parses an untrusted body into an envelope with every field the signature needs, or null. */
export function parseSnsEnvelope(raw: unknown): SnsEnvelope | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const required = ['Type', 'MessageId', 'TopicArn', 'Message', 'Timestamp', 'SignatureVersion', 'Signature', 'SigningCertURL'];
  if (!required.every((k) => isString(v[k]))) return null;
  return {
    Type: v.Type as string,
    MessageId: v.MessageId as string,
    TopicArn: v.TopicArn as string,
    Subject: isString(v.Subject) ? v.Subject : null,
    Message: v.Message as string,
    Timestamp: v.Timestamp as string,
    SignatureVersion: v.SignatureVersion as string,
    Signature: v.Signature as string,
    SigningCertURL: v.SigningCertURL as string,
    SubscribeURL: isString(v.SubscribeURL) ? v.SubscribeURL : undefined,
    Token: isString(v.Token) ? v.Token : undefined,
    UnsubscribeURL: isString(v.UnsubscribeURL) ? v.UnsubscribeURL : undefined,
  };
}

/** Only AWS's own SNS endpoints may serve the certificate or be called back. */
export function isTrustedSnsUrl(value: string, requirePem: boolean): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  if (!SNS_HOST.test(url.hostname)) return false;
  return !requirePem || url.pathname.endsWith('.pem');
}

/**
 * AWS regions that host SNS. The subscription callback host is built only
 * from this list (never from the message), so a message can never make the
 * API call an arbitrary host. Add a region here when AWS launches one we use.
 */
export const SNS_REGIONS = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'af-south-1', 'ap-east-1', 'ap-south-1', 'ap-south-2',
  'ap-southeast-1', 'ap-southeast-2', 'ap-southeast-3', 'ap-southeast-4', 'ap-southeast-5', 'ap-southeast-7',
  'ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3', 'ca-central-1', 'ca-west-1', 'eu-central-1', 'eu-central-2',
  'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-south-1', 'eu-south-2', 'eu-north-1', 'il-central-1', 'me-south-1',
  'me-central-1', 'mx-central-1', 'sa-east-1',
] as const;

const TOPIC_ARN = /^arn:aws:sns:([a-z0-9-]{1,32}):\d{12}:[A-Za-z0-9_-]{1,256}$/;

/**
 * The ConfirmSubscription URL for a verified SubscriptionConfirmation,
 * rebuilt from the signed TopicArn and Token: host from SNS_REGIONS, fixed
 * path and action. Null when the topic's region is unknown or the token is missing.
 */
export function snsConfirmSubscriptionUrl(msg: Pick<SnsEnvelope, 'TopicArn' | 'Token'>): string | null {
  const match = TOPIC_ARN.exec(msg.TopicArn);
  if (!match || !msg.Token) return null;
  const region = SNS_REGIONS.find((r) => r === match[1]);
  if (!region) return null;
  const url = new URL(`https://sns.${region}.amazonaws.com/`);
  url.searchParams.set('Action', 'ConfirmSubscription');
  url.searchParams.set('TopicArn', msg.TopicArn);
  url.searchParams.set('Token', msg.Token);
  return url.toString();
}

/** AWS's canonical string-to-sign for the message type, or null for an unknown type. */
export function snsStringToSign(msg: SnsEnvelope): string | null {
  let keys: (keyof SnsEnvelope)[];
  if (msg.Type === 'Notification') {
    keys = msg.Subject ? ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'] : ['Message', 'MessageId', 'Timestamp', 'TopicArn', 'Type'];
  } else if (msg.Type === 'SubscriptionConfirmation' || msg.Type === 'UnsubscribeConfirmation') {
    if (!msg.SubscribeURL || !msg.Token) return null;
    keys = ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];
  } else {
    return null;
  }
  return keys.map((k) => `${k}\n${msg[k] as string}\n`).join('');
}

export class SnsVerifier {
  private readonly certs = new Map<string, string>();

  constructor(private readonly fetchCert: SnsCertFetcher) {}

  async verify(msg: SnsEnvelope): Promise<boolean> {
    const algorithm = msg.SignatureVersion === '1' ? 'RSA-SHA1' : msg.SignatureVersion === '2' ? 'RSA-SHA256' : null;
    if (!algorithm) return false;
    if (!isTrustedSnsUrl(msg.SigningCertURL, true)) return false;
    const canonical = snsStringToSign(msg);
    if (!canonical) return false;
    let cert = this.certs.get(msg.SigningCertURL);
    if (!cert) {
      try {
        cert = await this.fetchCert(msg.SigningCertURL);
      } catch {
        return false;
      }
      if (this.certs.size > 20) this.certs.clear();
      this.certs.set(msg.SigningCertURL, cert);
    }
    try {
      return createVerify(algorithm).update(canonical, 'utf8').verify(cert, msg.Signature, 'base64');
    } catch {
      return false;
    }
  }
}

/** Production fetcher: bounded, time-limited download of the PEM certificate. */
export const fetchSnsCertificate: SnsCertFetcher = async (url: string) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!response.ok) throw new Error(`certificate HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > 16_384 || !text.includes('BEGIN CERTIFICATE')) throw new Error('not a certificate');
  return text;
};
