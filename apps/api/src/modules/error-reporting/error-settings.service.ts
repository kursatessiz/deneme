import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ErrorSettings, Prisma } from '@platform/database';
import {
  ERROR_ALERT_COOLDOWN_DEFAULT_MINUTES,
  ERROR_ALERT_COOLDOWN_MAX_MINUTES,
  ERROR_ALERT_COOLDOWN_MIN_MINUTES,
  resolveSpikeSettings,
} from '@platform/shared';
import type { ErrorSettingsDTO, ErrorSettingsUpdate, ErrorSpikeSettings } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialCipher } from '../../common/crypto/credential-cipher';
import { assertPublicHttpsHostname } from '../webhooks/ssrf-check';
import { apiError } from '../../common/api-error';

export const ERROR_SETTINGS_ID = 'platform';

export interface WebhookSinkConfig {
  url: string;
  secret: string;
}

/**
 * Platform error alert settings (single error_settings row, super admin
 * only): spike thresholds and the alert cooldown as data, and the alert sink
 * destinations. The webhook URL, its signing secret and the Slack URL are
 * encrypted with CredentialCipher (the pattern of the AI key and the ad
 * connections); they are never returned, only the webhook host and the last
 * four characters of the secret. ERROR_ALERT_COOLDOWN_MINUTES is the
 * fallback cooldown until the row exists.
 */
@Injectable()
export class ErrorSettingsService {
  private readonly logger = new Logger(ErrorSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: CredentialCipher,
    private readonly config: ConfigService,
  ) {}

  private get isProduction(): boolean {
    return this.config.get<string>('NODE_ENV') === 'production';
  }

  async getRow(): Promise<ErrorSettings | null> {
    return this.prisma.errorSettings.findUnique({ where: { id: ERROR_SETTINGS_ID } });
  }

  private envCooldown(): number {
    return this.config.get<number>('ERROR_ALERT_COOLDOWN_MINUTES') ?? ERROR_ALERT_COOLDOWN_DEFAULT_MINUTES;
  }

  async getSpikeSettings(row?: ErrorSettings | null): Promise<ErrorSpikeSettings> {
    const settings = row === undefined ? await this.getRow() : row;
    return resolveSpikeSettings(settings?.spike);
  }

  /** The per-group alert cooldown in minutes. */
  async getCooldownMinutes(row?: ErrorSettings | null): Promise<number> {
    const settings = row === undefined ? await this.getRow() : row;
    return settings?.cooldownMinutes ?? this.envCooldown();
  }

  /** The signed webhook's URL and secret, or null when either is missing or the sink is off. Never logged. */
  async getWebhookConfig(): Promise<WebhookSinkConfig | null> {
    const row = await this.getRow();
    if (!row || !row.webhookEnabled || !row.webhookUrlEncrypted || !row.webhookSecretEncrypted) return null;
    try {
      return { url: this.cipher.decrypt(row.webhookUrlEncrypted), secret: this.cipher.decrypt(row.webhookSecretEncrypted) };
    } catch {
      this.logger.warn('The stored alert webhook cannot be decrypted; set it again in the error alert settings.');
      return null;
    }
  }

  /** The Slack incoming webhook URL, or null when missing or the sink is off. Never logged. */
  async getSlackUrl(): Promise<string | null> {
    const row = await this.getRow();
    if (!row || !row.slackEnabled || !row.slackUrlEncrypted) return null;
    try {
      return this.cipher.decrypt(row.slackUrlEncrypted);
    } catch {
      this.logger.warn('The stored Slack alert URL cannot be decrypted; set it again in the error alert settings.');
      return null;
    }
  }

  async get(): Promise<ErrorSettingsDTO> {
    return this.toDto(await this.getRow());
  }

  async update(actorUserId: string, input: ErrorSettingsUpdate): Promise<ErrorSettingsDTO> {
    const existing = await this.getRow();
    const data: Prisma.ErrorSettingsUncheckedUpdateInput = { updatedByUserId: actorUserId };
    const touchesSecrets = input.webhook?.url != null || input.webhook?.secret != null || input.slack?.url != null;
    if (touchesSecrets && this.isProduction && !this.cipher.isConfigured) {
      throw new BadRequestException(apiError('apiErrors.errorReporting.alertTargetsCannotSavedBecauseNo'));
    }

    if (input.spike) {
      const merged = { ...resolveSpikeSettings(existing?.spike), ...input.spike };
      data.spike = merged as unknown as Prisma.InputJsonValue;
    }
    if (input.cooldownMinutes !== undefined) {
      data.cooldownMinutes = Math.min(ERROR_ALERT_COOLDOWN_MAX_MINUTES, Math.max(ERROR_ALERT_COOLDOWN_MIN_MINUTES, input.cooldownMinutes));
    }

    if (input.webhook) {
      const { url, secret, enabled } = input.webhook;
      if (enabled !== undefined) data.webhookEnabled = enabled;
      if (url === null) {
        data.webhookUrlEncrypted = null;
        data.webhookUrlHost = null;
        data.webhookSecretEncrypted = null;
        data.webhookSecretLast4 = null;
      } else if (url !== undefined) {
        // Same SSRF guard as the webhooks module (https, no private or reserved address); re-checked at delivery.
        await assertPublicHttpsHostname(url);
        data.webhookUrlEncrypted = this.cipher.encrypt(url);
        data.webhookUrlHost = new URL(url).hostname;
      }
      if (secret === null) {
        data.webhookSecretEncrypted = null;
        data.webhookSecretLast4 = null;
      } else if (secret !== undefined) {
        data.webhookSecretEncrypted = this.cipher.encrypt(secret);
        data.webhookSecretLast4 = secret.slice(-4);
      }
    }

    if (input.slack) {
      const { url, enabled } = input.slack;
      if (enabled !== undefined) data.slackEnabled = enabled;
      if (url === null) data.slackUrlEncrypted = null;
      else if (url !== undefined) data.slackUrlEncrypted = this.cipher.encrypt(url);
    }

    const cooldownOnCreate = typeof data.cooldownMinutes === 'number' ? data.cooldownMinutes : this.envCooldown();
    const row = await this.prisma.errorSettings.upsert({
      where: { id: ERROR_SETTINGS_ID },
      create: { id: ERROR_SETTINGS_ID, ...(data as Prisma.ErrorSettingsUncheckedCreateInput), cooldownMinutes: cooldownOnCreate },
      update: data,
    });
    await this.prisma.auditLog.create({
      data: {
        studioId: null,
        userId: actorUserId,
        action: 'error_settings.update',
        entityType: 'ErrorSettings',
        entityId: ERROR_SETTINGS_ID,
        // Which parts changed, never the values (URLs and the secret are credentials).
        metadata: {
          spike: input.spike !== undefined,
          cooldownMinutes: input.cooldownMinutes ?? null,
          webhook: input.webhook !== undefined,
          slack: input.slack !== undefined,
        },
      },
    });
    return this.toDto(row);
  }

  private toDto(row: ErrorSettings | null): ErrorSettingsDTO {
    return {
      spike: resolveSpikeSettings(row?.spike),
      cooldownMinutes: row?.cooldownMinutes ?? this.envCooldown(),
      webhook: {
        configured: Boolean(row?.webhookUrlEncrypted && row.webhookSecretEncrypted),
        host: row?.webhookUrlHost ?? null,
        secretLast4: row?.webhookSecretLast4 ?? null,
        enabled: row?.webhookEnabled ?? true,
      },
      slack: { configured: Boolean(row?.slackUrlEncrypted), enabled: row?.slackEnabled ?? true },
      encryptionAvailable: this.cipher.isConfigured || !this.isProduction,
    };
  }
}
