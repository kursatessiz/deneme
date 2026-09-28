import { createSign, generateKeyPairSync } from 'crypto';
import { SnsVerifier, isTrustedSnsUrl, parseSnsEnvelope, snsStringToSign } from './sns-verifier';
import type { SnsEnvelope } from './sns-verifier';
import { signMetaBody, verifyMetaSignature } from './whatsapp-signature';
import { mapSmsDlrStatus } from './sms-dlr.controller';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const CERT_URL = 'https://sns.eu-central-1.amazonaws.com/SimpleNotificationService-abc.pem';

function signed(msg: Omit<SnsEnvelope, 'Signature'>, algorithm: 'RSA-SHA1' | 'RSA-SHA256'): SnsEnvelope {
  const unsigned = { ...msg, Signature: '' };
  const signature = createSign(algorithm).update(snsStringToSign(unsigned)!, 'utf8').sign(privateKey, 'base64');
  return { ...unsigned, Signature: signature };
}

const notification = (version: '1' | '2'): Omit<SnsEnvelope, 'Signature'> => ({
  Type: 'Notification',
  MessageId: 'm-1',
  TopicArn: 'arn:aws:sns:eu-central-1:123456789012:ses-events',
  Subject: null,
  Message: JSON.stringify({ eventType: 'Bounce', mail: { messageId: 'ses-1' }, bounce: { bounceType: 'Permanent' } }),
  Timestamp: '2026-06-15T12:00:00.000Z',
  SignatureVersion: version,
  SigningCertURL: CERT_URL,
});

describe('SNS signature verification', () => {
  const fetcher = jest.fn(async (url: string) => {
    if (url !== CERT_URL) throw new Error('unexpected url');
    return PUBLIC_PEM;
  });
  const verifier = new SnsVerifier(fetcher);

  it('accepts SignatureVersion 1 (SHA1) and 2 (SHA256) messages signed by the certificate key', async () => {
    await expect(verifier.verify(signed(notification('1'), 'RSA-SHA1'))).resolves.toBe(true);
    await expect(verifier.verify(signed(notification('2'), 'RSA-SHA256'))).resolves.toBe(true);
  });

  it('rejects a tampered message, a wrong algorithm and an unknown signature version', async () => {
    const good = signed(notification('2'), 'RSA-SHA256');
    await expect(verifier.verify({ ...good, Message: good.Message.replace('Permanent', 'Transient') })).resolves.toBe(false);
    await expect(verifier.verify({ ...signed(notification('2'), 'RSA-SHA1') })).resolves.toBe(false);
    await expect(verifier.verify({ ...good, SignatureVersion: '3' })).resolves.toBe(false);
  });

  it('never fetches a certificate from outside AWS SNS', async () => {
    fetcher.mockClear();
    const msg = signed({ ...notification('2'), SigningCertURL: 'https://evil.example.com/cert.pem' }, 'RSA-SHA256');
    await expect(verifier.verify(msg)).resolves.toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(isTrustedSnsUrl('https://sns.us-east-1.amazonaws.com/x.pem', true)).toBe(true);
    expect(isTrustedSnsUrl('http://sns.us-east-1.amazonaws.com/x.pem', true)).toBe(false);
    expect(isTrustedSnsUrl('https://sns.us-east-1.amazonaws.com.evil.com/x.pem', true)).toBe(false);
    expect(isTrustedSnsUrl('https://sns.us-east-1.amazonaws.com/x.txt', true)).toBe(false);
    expect(isTrustedSnsUrl('https://user@sns.us-east-1.amazonaws.com/x.pem', true)).toBe(false);
  });

  it('builds the canonical string for subscription confirmations and parses text/plain bodies', () => {
    const sub = parseSnsEnvelope(
      JSON.stringify({ ...notification('1'), Type: 'SubscriptionConfirmation', SubscribeURL: 'https://sns.eu-central-1.amazonaws.com/?Action=Confirm', Token: 't', Signature: 's' }),
    );
    expect(sub).not.toBeNull();
    expect(snsStringToSign(sub!)).toContain('SubscribeURL\nhttps://sns.eu-central-1.amazonaws.com/?Action=Confirm\n');
    expect(parseSnsEnvelope('{not json')).toBeNull();
    expect(parseSnsEnvelope({ Type: 'Notification' })).toBeNull();
  });
});

describe('WhatsApp X-Hub-Signature-256', () => {
  const body = Buffer.from('{"object":"whatsapp_business_account","entry":[]}');
  it('accepts the exact body signed with the app secret', () => {
    expect(verifyMetaSignature(body, signMetaBody(body, 'app-secret'), 'app-secret')).toBe(true);
  });
  it('rejects another secret, a changed body, a missing or malformed header', () => {
    expect(verifyMetaSignature(body, signMetaBody(body, 'other'), 'app-secret')).toBe(false);
    expect(verifyMetaSignature(Buffer.from(`${body.toString()} `), signMetaBody(body, 'app-secret'), 'app-secret')).toBe(false);
    expect(verifyMetaSignature(body, undefined, 'app-secret')).toBe(false);
    expect(verifyMetaSignature(body, 'sha1=abc', 'app-secret')).toBe(false);
    expect(verifyMetaSignature(body, signMetaBody(body, 'app-secret'), '')).toBe(false);
  });
});

describe('Netgsm / İleti Merkezi delivery report statuses', () => {
  it.each([
    ['1', 'DELIVERED'],
    ['delivered', 'DELIVERED'],
    ['0', 'SENT'],
    ['3', 'FAILED'],
    ['UNDELIVERED', 'FAILED'],
    ['??', null],
  ])('%s -> %s', (raw, expected) => {
    expect(mapSmsDlrStatus(raw)).toBe(expected);
  });
});
