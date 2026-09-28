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
