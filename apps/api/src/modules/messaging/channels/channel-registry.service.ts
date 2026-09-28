import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SmsProviderKey } from '@platform/shared';
import { ProviderRegistry } from '../../../common/provider-registry';
import type { SmsChannelAdapter } from './message-channel.interface';
import { SmsNetgsmAdapter } from './sms-netgsm.adapter';
import { SmsIletiMerkeziAdapter } from './sms-iletimerkezi.adapter';
import { SmsTwilioAdapter } from './sms-twilio.adapter';
import { WhatsAppCloudAdapter } from './whatsapp-cloud.adapter';
import { SesEmailAdapter } from './email-ses.adapter';

/**
 * Picks the delivery adapter per channel (docs/BUYUME_VE_GLOBAL_MIMARI.md
 * section 2.2) on the shared ProviderRegistry:
 *
 * SMS, for the recipient's country (from the phone number, else the
 * studio's):
 *   1. the tenant's pinned provider (messaging settings), when it names a known key;
 *   2. the country's priority list, first configured adapter (TR: Netgsm,
 *      then İleti Merkezi);
 *   3. the global default: SMS_PROVIDER when it names a real provider,
 *      otherwise Twilio;
 *   4. any other configured adapter;
 *   5. nothing configured: the first candidate, which simulates success
 *      (MOCK), exactly as before this registry existed.
 *
 * WhatsApp (Cloud API) and email (Amazon SES) are registries with a single
 * global entry today, the same for Türkiye (docs section 2.2 table); a
 * regional adapter is one more catalogue entry. Push (Expo) and in-app are
 * delivered by the engine itself (no third-party choice to make).
 */
@Injectable()
export class MessagingChannelRegistry {
  private readonly sms: ProviderRegistry<SmsChannelAdapter>;
  private readonly whatsappProviders: ProviderRegistry<WhatsAppCloudAdapter>;
  private readonly emailProviders: ProviderRegistry<SesEmailAdapter>;

  constructor(
    private readonly config: ConfigService,
    netgsm: SmsNetgsmAdapter,
    iletiMerkezi: SmsIletiMerkeziAdapter,
    twilio: SmsTwilioAdapter,
    readonly whatsapp: WhatsAppCloudAdapter,
    readonly email: SesEmailAdapter,
  ) {
    this.sms = new ProviderRegistry<SmsChannelAdapter>([
      { key: 'NETGSM', adapter: netgsm, countries: ['TR'] },
      { key: 'ILETI_MERKEZI', adapter: iletiMerkezi, countries: ['TR'] },
      { key: 'TWILIO', adapter: twilio, countries: ['*'] },
    ]);
    this.whatsappProviders = new ProviderRegistry([{ key: whatsapp.key, adapter: whatsapp, countries: ['*'] }]);
    this.emailProviders = new ProviderRegistry([{ key: email.key, adapter: email, countries: ['*'] }]);
  }

  /** WhatsApp adapter for the recipient's country (Cloud API everywhere today). */
  resolveWhatsApp(countryCode: string | null | undefined): WhatsAppCloudAdapter {
    return this.whatsappProviders.resolveFor(countryCode) ?? this.whatsapp;
  }

  /** Email adapter for the recipient's country (Amazon SES everywhere today). */
  resolveEmail(countryCode: string | null | undefined): SesEmailAdapter {
    return this.emailProviders.resolveFor(countryCode) ?? this.email;
  }

  /** The env default (SMS_PROVIDER) when it names a real provider; MOCK means "no preference". */
  private globalDefaultKey(): SmsProviderKey {
    const env = this.config.get<string>('SMS_PROVIDER', 'MOCK');
    return env === 'NETGSM' || env === 'ILETI_MERKEZI' || env === 'TWILIO' ? env : 'TWILIO';
  }

  resolveSms(countryCode: string | null | undefined, tenantOverride: SmsProviderKey | null | undefined): SmsChannelAdapter {
    if (tenantOverride) {
      const pinned = this.sms.byKey(tenantOverride);
      if (pinned) return pinned;
    }
    const globalDefault = this.sms.byKey(this.globalDefaultKey());
    const countrySpecific = this.sms.candidatesFor(countryCode).filter((e) => !e.countries.includes('*')).map((e) => e.adapter);
    const ordered: SmsChannelAdapter[] = [];
    for (const adapter of [...countrySpecific, globalDefault, ...this.sms.keys().map((k) => this.sms.byKey(k))]) {
      if (adapter && !ordered.includes(adapter)) ordered.push(adapter);
    }
    return ordered.find((a) => a.isConfigured()) ?? ordered[0];
  }

  smsByKey(key: string): SmsChannelAdapter | null {
    return this.sms.byKey(key);
  }

  smsKeys(): string[] {
    return this.sms.keys();
  }
}
