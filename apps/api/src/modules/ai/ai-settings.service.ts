import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type AiSettings } from '@platform/database';
import {
  AI_PRICE_TABLE,
  AI_TASKS,
  DEFAULT_AI_MODELS,
  DEFAULT_MARKETING_AI_BUDGET_CENTS,
  DEFAULT_TENANT_AI_BUDGET_CENTS,
  AiModelIdSchema,
  AiModelPriceSchema,
  isAiErrorCode,
  type AiKeySource,
  type AiModelPrice,
  type AiSettingsDTO,
  type AiTask,
  type UpdateAiSettingsInput,
} from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialCipher } from '../../common/crypto/credential-cipher';
import { AiError } from './ai-errors';

export const AI_SETTINGS_ID = 'platform';

export interface ActiveAiKey {
  key: string;
  source: AiKeySource;
}

type SettingsRow = AiSettings;

/** Last four characters shown in the admin screen; the rest never leaves the server. */
export function keyLast4(apiKey: string): string {
  return apiKey.slice(-4);
}

function parseModels(raw: Prisma.JsonValue | undefined): Record<AiTask, string> {
  const models: Record<AiTask, string> = { ...DEFAULT_AI_MODELS };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const task of AI_TASKS) {
      const value = (raw as Record<string, unknown>)[task];
      if (typeof value === 'string' && AiModelIdSchema.safeParse(value).success) models[task] = value;
    }
  }
  return models;
}

function parsePriceOverrides(raw: Prisma.JsonValue | undefined): Record<string, AiModelPrice> {
  const result: Record<string, AiModelPrice> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [model, value] of Object.entries(raw as Record<string, unknown>)) {
      const parsed = AiModelPriceSchema.safeParse(value);
      if (parsed.success && AiModelIdSchema.safeParse(model).success) result[model] = parsed.data;
    }
  }
  return result;
}

/**
 * Platform AI settings (single ai_settings row): the provider key stored
 * encrypted with CredentialCipher (same pattern as ad connections: cipher
 * text plus last four characters, the key is never returned), the model per
 * task, price overrides and the default tenant budget. ANTHROPIC_API_KEY is
 * the fallback when no key is stored.
 */
@Injectable()
export class AiSettingsService {
  private readonly logger = new Logger(AiSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: CredentialCipher,
    private readonly config: ConfigService,
  ) {}

  async getRow(): Promise<SettingsRow | null> {
    return this.prisma.aiSettings.findUnique({ where: { id: AI_SETTINGS_ID } });
  }

  /** The key to call the provider with, or null when AI is off. Never logged. */
  async getActiveKey(row?: SettingsRow | null): Promise<ActiveAiKey | null> {
    const settings = row === undefined ? await this.getRow() : row;
    if (settings?.encryptedApiKey) {
      try {
        return { key: this.cipher.decrypt(settings.encryptedApiKey), source: 'DATABASE' };
      } catch {
        // A rotated INTEGRATION_ENCRYPTION_KEY makes the stored key unreadable.
        this.logger.warn('The stored AI provider key cannot be decrypted; set it again in the AI settings.');
      }
    }
    const envKey = this.config.get<string>('ANTHROPIC_API_KEY');
    return envKey ? { key: envKey, source: 'ENV' } : null;
  }

  async getModels(row?: SettingsRow | null): Promise<Record<AiTask, string>> {
    const settings = row === undefined ? await this.getRow() : row;
    return parseModels(settings?.models);
  }

  async getPriceOverrides(row?: SettingsRow | null): Promise<Record<string, AiModelPrice>> {
    const settings = row === undefined ? await this.getRow() : row;
    return parsePriceOverrides(settings?.priceOverrides);
  }

  async getDefaultBudgetCents(): Promise<number> {
    const settings = await this.getRow();
    return settings?.defaultMonthlyBudgetCents ?? DEFAULT_TENANT_AI_BUDGET_CENTS;
  }

  /** Monthly cap of the marketing studio on the platform tenant (cents). */
  async getMarketingBudgetCents(): Promise<number> {
    const settings = await this.getRow();
    return settings?.marketingAiMonthlyBudgetCents ?? DEFAULT_MARKETING_AI_BUDGET_CENTS;
  }

  async setKey(actorUserId: string, apiKey: string): Promise<void> {
    if (this.config.get<string>('NODE_ENV') === 'production' && !this.cipher.isConfigured) {
      throw new AiError('AI_ENCRYPTION_UNAVAILABLE');
    }
    const data = {
      encryptedApiKey: this.cipher.encrypt(apiKey),
      apiKeyLast4: keyLast4(apiKey),
      apiKeyUpdatedAt: new Date(),
      apiKeyUpdatedByUserId: actorUserId,
      lastTestAt: null,
      lastTestOk: null,
      lastTestErrorCode: null,
    };
    await this.prisma.$transaction([
      this.prisma.aiSettings.upsert({ where: { id: AI_SETTINGS_ID }, create: { id: AI_SETTINGS_ID, ...data }, update: data }),
      this.prisma.auditLog.create({
        data: { userId: actorUserId, action: 'ai.key.set', entityType: 'AiSettings', entityId: AI_SETTINGS_ID, metadata: { last4: data.apiKeyLast4 } },
      }),
    ]);
  }

  async removeKey(actorUserId: string): Promise<void> {
    const data = {
      encryptedApiKey: null,
      apiKeyLast4: null,
      apiKeyUpdatedAt: new Date(),
      apiKeyUpdatedByUserId: actorUserId,
      lastTestAt: null,
      lastTestOk: null,
      lastTestErrorCode: null,
    };
    await this.prisma.$transaction([
      this.prisma.aiSettings.upsert({ where: { id: AI_SETTINGS_ID }, create: { id: AI_SETTINGS_ID, ...data }, update: data }),
      this.prisma.auditLog.create({
        data: { userId: actorUserId, action: 'ai.key.remove', entityType: 'AiSettings', entityId: AI_SETTINGS_ID },
      }),
    ]);
  }

  async recordTest(ok: boolean, errorCode: string | null): Promise<void> {
    const data = { lastTestAt: new Date(), lastTestOk: ok, lastTestErrorCode: errorCode };
    await this.prisma.aiSettings.upsert({ where: { id: AI_SETTINGS_ID }, create: { id: AI_SETTINGS_ID, ...data }, update: data });
  }

  async update(actorUserId: string, input: UpdateAiSettingsInput): Promise<void> {
    const row = await this.getRow();
    const data: Prisma.AiSettingsUpdateInput = {};
    if (input.models) data.models = { ...parseModels(row?.models), ...input.models } as Prisma.InputJsonValue;
    if (input.priceOverrides) data.priceOverrides = input.priceOverrides as Prisma.InputJsonValue;
    if (input.defaultMonthlyBudgetCents !== undefined) data.defaultMonthlyBudgetCents = input.defaultMonthlyBudgetCents;
    if (input.marketingAiMonthlyBudgetCents !== undefined) data.marketingAiMonthlyBudgetCents = input.marketingAiMonthlyBudgetCents;
    await this.prisma.$transaction([
      this.prisma.aiSettings.upsert({
        where: { id: AI_SETTINGS_ID },
        create: {
          id: AI_SETTINGS_ID,
          models: (data.models ?? {}) as Prisma.InputJsonValue,
          priceOverrides: (data.priceOverrides ?? {}) as Prisma.InputJsonValue,
          ...(input.defaultMonthlyBudgetCents !== undefined ? { defaultMonthlyBudgetCents: input.defaultMonthlyBudgetCents } : {}),
          ...(input.marketingAiMonthlyBudgetCents !== undefined ? { marketingAiMonthlyBudgetCents: input.marketingAiMonthlyBudgetCents } : {}),
        },
        update: data,
      }),
      this.prisma.auditLog.create({
        data: { userId: actorUserId, action: 'ai.settings.update', entityType: 'AiSettings', entityId: AI_SETTINGS_ID, metadata: input as Prisma.InputJsonValue },
      }),
    ]);
  }

  async toDTO(jobMode: AiSettingsDTO['jobMode']): Promise<AiSettingsDTO> {
    const row = await this.getRow();
    const active = await this.getActiveKey(row);
    const priceOverrides = parsePriceOverrides(row?.priceOverrides);
    const envKey = this.config.get<string>('ANTHROPIC_API_KEY');
    const lastTestErrorCode = row?.lastTestErrorCode;
    return {
      configured: active !== null,
      keySource: active?.source ?? null,
      keyLast4: active?.source === 'DATABASE' ? (row?.apiKeyLast4 ?? null) : envKey ? keyLast4(envKey) : null,
      keyUpdatedAt: row?.apiKeyUpdatedAt?.toISOString() ?? null,
      lastTestAt: row?.lastTestAt?.toISOString() ?? null,
      lastTestOk: row?.lastTestOk ?? null,
      lastTestErrorCode: isAiErrorCode(lastTestErrorCode) ? lastTestErrorCode : null,
      models: parseModels(row?.models),
      priceOverrides,
      effectivePrices: { ...AI_PRICE_TABLE, ...priceOverrides },
      defaultMonthlyBudgetCents: row?.defaultMonthlyBudgetCents ?? DEFAULT_TENANT_AI_BUDGET_CENTS,
      marketingAiMonthlyBudgetCents: row?.marketingAiMonthlyBudgetCents ?? DEFAULT_MARKETING_AI_BUDGET_CENTS,
      jobMode,
    };
  }
}
