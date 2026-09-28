import type { ConfigService } from '@nestjs/config';
import { MessagingChannelRegistry } from './channel-registry.service';
import type { SmsNetgsmAdapter } from './sms-netgsm.adapter';
import type { SmsIletiMerkeziAdapter } from './sms-iletimerkezi.adapter';
import type { SmsTwilioAdapter } from './sms-twilio.adapter';
import type { WhatsAppCloudAdapter } from './whatsapp-cloud.adapter';
import type { SesEmailAdapter } from './email-ses.adapter';

function adapter<K extends string>(key: K, configured: boolean) {
  return { name: 'SMS' as const, key, isConfigured: () => configured, send: jest.fn(), getBalance: jest.fn() };
}

function build(configured: { netgsm?: boolean; ileti?: boolean; twilio?: boolean }, env: Record<string, string> = {}) {
  const netgsm = adapter('NETGSM', !!configured.netgsm);
  const ileti = adapter('ILETI_MERKEZI', !!configured.ileti);
  const twilio = adapter('TWILIO', !!configured.twilio);
  const config = { get: jest.fn((key: string, fallback?: string) => env[key] ?? fallback) } as unknown as ConfigService;
  const registry = new MessagingChannelRegistry(
    config,
    netgsm as unknown as SmsNetgsmAdapter,
    ileti as unknown as SmsIletiMerkeziAdapter,
    twilio as unknown as SmsTwilioAdapter,
    {} as WhatsAppCloudAdapter,
    {} as SesEmailAdapter,
  );
  return { registry, netgsm, ileti, twilio };
}

describe('MessagingChannelRegistry.resolveSms', () => {
  it('TR prefers Netgsm, then İleti Merkezi, by what is configured', () => {
    expect(build({ netgsm: true, ileti: true, twilio: true }).registry.resolveSms('TR', null).key).toBe('NETGSM');
    expect(build({ ileti: true, twilio: true }).registry.resolveSms('TR', null).key).toBe('ILETI_MERKEZI');
  });

  it('every other country gets Twilio', () => {
    expect(build({ netgsm: true, twilio: true }).registry.resolveSms('US', null).key).toBe('TWILIO');
    expect(build({ netgsm: true, twilio: true }).registry.resolveSms('DE', null).key).toBe('TWILIO');
    expect(build({ twilio: true }).registry.resolveSms(null, null).key).toBe('TWILIO');
  });

  it('a tenant override wins even over the country list', () => {
    expect(build({ netgsm: true, twilio: true }).registry.resolveSms('TR', 'TWILIO').key).toBe('TWILIO');
    expect(build({ twilio: true }).registry.resolveSms('US', 'NETGSM').key).toBe('NETGSM');
  });

  it('SMS_PROVIDER is only the global default for countries without their own list', () => {
    const { registry } = build({ ileti: true, twilio: true, netgsm: true }, { SMS_PROVIDER: 'ILETI_MERKEZI' });
    expect(registry.resolveSms('US', null).key).toBe('ILETI_MERKEZI');
    expect(registry.resolveSms('TR', null).key).toBe('NETGSM');
    // MOCK means "no preference": Twilio stays the global default.
    expect(build({ netgsm: true, twilio: true }, { SMS_PROVIDER: 'MOCK' }).registry.resolveSms('GB', null).key).toBe('TWILIO');
  });

  it('keeps today\'s TR deployments working: only İleti Merkezi configured via SMS_PROVIDER', () => {
    expect(build({ ileti: true }, { SMS_PROVIDER: 'ILETI_MERKEZI' }).registry.resolveSms('TR', null).key).toBe('ILETI_MERKEZI');
  });

  it('falls back to any configured adapter, then to the first candidate in MOCK mode', () => {
    expect(build({ netgsm: true }).registry.resolveSms('US', null).key).toBe('NETGSM');
    expect(build({}).registry.resolveSms('TR', null).key).toBe('NETGSM');
    expect(build({}).registry.resolveSms('US', null).key).toBe('TWILIO');
  });
});
