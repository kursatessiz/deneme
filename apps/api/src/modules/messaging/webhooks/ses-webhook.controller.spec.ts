import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { createSign, generateKeyPairSync } from 'crypto';
import type { DeliveryStatusService } from './delivery-status.service';
import { SesWebhookController } from './ses-webhook.controller';
import { snsStringToSign } from './sns-verifier';
import type { SnsEnvelope } from './sns-verifier';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const CERT_URL = 'https://sns.eu-central-1.amazonaws.com/SimpleNotificationService-abc.pem';
const OWN_TOPIC = 'arn:aws:sns:eu-central-1:111111111111:own-ses-events';
const FOREIGN_TOPIC = 'arn:aws:sns:eu-central-1:999999999999:attacker-topic';

function signedComplaint(topicArn: string): SnsEnvelope {
  const unsigned: SnsEnvelope = {
    Type: 'Notification',
    MessageId: 'm-1',
    TopicArn: topicArn,
    Subject: null,
    Message: JSON.stringify({ eventType: 'Complaint', mail: { messageId: 'ses-victim' }, complaint: { complaintFeedbackType: 'abuse' } }),
    Timestamp: '2026-06-15T12:00:00.000Z',
    SignatureVersion: '2',
    SigningCertURL: CERT_URL,
    Signature: '',
  };
  const signature = createSign('RSA-SHA256').update(snsStringToSign(unsigned)!, 'utf8').sign(privateKey, 'base64');
  return { ...unsigned, Signature: signature };
}

function build(allowlist: string | undefined) {
  const apply = jest.fn(async () => 1);
  const config = { get: (key: string) => (key === 'SES_SNS_TOPIC_ARNS' ? allowlist : undefined) } as unknown as ConfigService;
  const controller = new SesWebhookController({ apply } as unknown as DeliveryStatusService, config, async () => PUBLIC_PEM);
  return { controller, apply };
}

describe('SesWebhookController topic binding', () => {
  it('rejects every message when SES_SNS_TOPIC_ARNS is empty or unset (fail closed)', async () => {
    for (const allowlist of [undefined, '', ' , ']) {
      const { controller, apply } = build(allowlist);
      await expect(controller.receive(signedComplaint(FOREIGN_TOPIC))).rejects.toBeInstanceOf(ForbiddenException);
      expect(apply).not.toHaveBeenCalled();
    }
  });

  it('rejects a validly signed message from a topic outside the allowlist', async () => {
    const { controller, apply } = build(OWN_TOPIC);
    await expect(controller.receive(signedComplaint(FOREIGN_TOPIC))).rejects.toBeInstanceOf(ForbiddenException);
    expect(apply).not.toHaveBeenCalled();
  });

  it('applies a signed message from an allowlisted topic, scoped to the EMAIL channel', async () => {
    const { controller, apply } = build(`${FOREIGN_TOPIC}, ${OWN_TOPIC}`);
    await expect(controller.receive(signedComplaint(OWN_TOPIC))).resolves.toEqual({ ok: true, type: 'Complaint' });
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ providerMessageId: 'ses-victim', kind: 'COMPLAINED', channel: 'EMAIL' }));
  });
});
