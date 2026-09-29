import { Logger, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { I18nModule } from '../i18n/i18n.module';
import { CredentialCipher } from '../../common/crypto/credential-cipher';
import { AI_PROVIDER_ADAPTER, type AiProviderAdapter } from './providers/ai-provider';
import { AnthropicAiAdapter } from './providers/anthropic.adapter';
import { FakeAiAdapter } from './providers/fake-ai.adapter';
import { AiSettingsService } from './ai-settings.service';
import { AiUsageService } from './ai-usage.service';
import { AiService } from './ai.service';
import { AiWritingService } from './ai-writing.service';
import { AdminAiController, AdminAiTranslationController } from './admin-ai.controller';
import { AiInboxController, AiTenantController } from './ai-tenant.controller';
import { AI_QUEUE, AiQueueService } from './translation/ai-queue.service';
import { AiProcessor } from './translation/ai.processor';
import { GlossaryService } from './translation/glossary.service';
import { TranslationEngineService } from './translation/translation-engine.service';

/** Same rule as JobsModule: BullMQ only when REDIS_URL is a real process env var (see jobs.module.ts). */
const redisConfigured = Boolean(process.env.REDIS_URL);

/**
 * The fake provider exists for the automated suites only (AI_FAKE_PROVIDER=1).
 * env.ts already refuses it in production; this is the second lock.
 */
export function createAiProviderAdapter(config: ConfigService): AiProviderAdapter {
  if (config.get<string>('AI_FAKE_PROVIDER') === '1') {
    if (config.get<string>('NODE_ENV') === 'production') throw new Error('AI_FAKE_PROVIDER must not be enabled in production');
    new Logger('AiModule').warn('AI_FAKE_PROVIDER=1: using the deterministic fake AI provider.');
    return new FakeAiAdapter();
  }
  return new AnthropicAiAdapter();
}

/**
 * AI core (G3b, docs/YAPAY_ZEKA.md): provider adapter, encrypted key,
 * model per task, usage and cost metering with per-tenant monthly budgets,
 * the background translation engine and the tenant writing helpers.
 */
@Module({
  imports: [AuthModule, I18nModule, ...(redisConfigured ? [BullModule.registerQueue({ name: AI_QUEUE })] : [])],
  controllers: [AdminAiController, AdminAiTranslationController, AiTenantController, AiInboxController],
  providers: [
    CredentialCipher,
    { provide: AI_PROVIDER_ADAPTER, useFactory: createAiProviderAdapter, inject: [ConfigService] },
    AiSettingsService,
    AiUsageService,
    AiService,
    AiWritingService,
    AiQueueService,
    GlossaryService,
    TranslationEngineService,
    ...(redisConfigured ? [AiProcessor] : []),
  ],
  exports: [AiService, TranslationEngineService],
})
export class AiModule {}
