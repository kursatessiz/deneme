import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SocialProvider } from '@platform/shared';
import { AdsHttpClient } from '../ads/ads-http-client';
import type { SocialPublisher } from './social-publisher';
import { FakeSocialPublisher } from './publishers/fake.publisher';
import { InstagramPublisher } from './publishers/instagram.publisher';
import { LinkedInOrgPublisher } from './publishers/linkedin-org.publisher';
import { MetaPagePublisher } from './publishers/meta-page.publisher';

/**
 * The publisher of each provider. SOCIAL_FAKE_PROVIDER=1 swaps every one of
 * them for the deterministic fake of the automated suites; env.ts already
 * refuses that flag in production and this is the second lock.
 */
@Injectable()
export class SocialPublisherRegistry {
  private readonly publishers: Readonly<Record<SocialProvider, SocialPublisher>>;

  constructor(http: AdsHttpClient, config: ConfigService) {
    if (config.get<string>('SOCIAL_FAKE_PROVIDER') === '1') {
      if (config.get<string>('NODE_ENV') === 'production') throw new Error('SOCIAL_FAKE_PROVIDER must not be enabled in production');
      new Logger(SocialPublisherRegistry.name).warn('SOCIAL_FAKE_PROVIDER=1: using the deterministic fake social publishers.');
      this.publishers = {
        META_PAGE: new FakeSocialPublisher('META_PAGE'),
        INSTAGRAM: new FakeSocialPublisher('INSTAGRAM'),
        LINKEDIN_ORG: new FakeSocialPublisher('LINKEDIN_ORG'),
      };
      return;
    }
    this.publishers = {
      META_PAGE: new MetaPagePublisher(http),
      INSTAGRAM: new InstagramPublisher(http),
      LINKEDIN_ORG: new LinkedInOrgPublisher(http),
    };
  }

  for(provider: SocialProvider): SocialPublisher {
    return this.publishers[provider];
  }
}
