import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CredentialCipher } from '../../common/crypto/credential-cipher';
import { AiSettingsService } from './ai-settings.service';
import { AiUsageService } from './ai-usage.service';
import { AiService } from './ai.service';
import { AiError } from './ai-errors';
import { FakeAiAdapter } from './providers/fake-ai.adapter';
import type { PrismaService } from '../prisma/prisma.service';
import { toPlainText } from './prompts';

const ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64');
const API_KEY = 'sk-ant-api03-unit-test-key-0000WXYZ';
const STUDIO = 'studio-1';

interface State {
  settings: Record<string, unknown> | null;
  usage: Array<Record<string, unknown>>;
  studioBudget: number | null;
  planLimits: Record<string, unknown> | null;
  audit: Array<Record<string, unknown>>;
  /** marketing_settings.ai_daily_cap_cents of the studio; null: no row or no cap. */
  aiDailyCapCents?: number | null;
}

/** Just enough of Prisma for the AI services, kept in memory. */
function fakePrisma(state: State): PrismaService {
  const prisma = {
    aiSettings: {
      findUnique: jest.fn(async () => state.settings),
      upsert: jest.fn(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        state.settings = state.settings ? { ...state.settings, ...update } : { defaultMonthlyBudgetCents: 500, models: {}, priceOverrides: {}, ...create };
        return state.settings;
      }),
    },
    auditLog: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => state.audit.push(data)) },
    aiUsage: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.usage.push({ ...data, createdAt: new Date() });
        return { id: `usage-${state.usage.length}` };
      }),
      aggregate: jest.fn(async ({ where }: { where: { studioId: string; createdAt?: { gte: Date } } }) => ({
        _sum: {
          costMicroUsd: state.usage
            .filter((u) => u.studioId === where.studioId)
            .filter((u) => !where.createdAt || u.createdAt === undefined || (u.createdAt as Date) >= where.createdAt.gte)
            .reduce((n, u) => n + (u.costMicroUsd as number), 0),
        },
      })),
    },
    marketingSettings: { findUnique: jest.fn(async () => (state.aiDailyCapCents === undefined ? null : { aiDailyCapCents: state.aiDailyCapCents })) },
    studio: { findUnique: jest.fn(async () => ({ aiMonthlyBudgetCents: state.studioBudget })) },
    subscription: { findFirst: jest.fn(async () => (state.planLimits ? { plan: { limits: state.planLimits } } : null)) },
    $transaction: jest.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops)),
  };
  return prisma as unknown as PrismaService;
}

function setup(overrides: Partial<State> = {}, env: Record<string, string | undefined> = {}) {
  const state: State = { settings: null, usage: [], studioBudget: null, planLimits: null, audit: [], ...overrides };
  const config = { get: (name: string) => ({ INTEGRATION_ENCRYPTION_KEY: ENCRYPTION_KEY, NODE_ENV: 'test', ...env })[name] } as unknown as ConfigService;
  const prisma = fakePrisma(state);
  const settings = new AiSettingsService(prisma, new CredentialCipher(config), config);
  const usage = new AiUsageService(prisma, settings);
  const adapter = new FakeAiAdapter();
  const ai = new AiService(settings, usage, adapter);
  return { state, settings, usage, adapter, ai };
}

const request = {
  task: 'COPYWRITING' as const,
  studioId: STUDIO,
  userId: 'user-1',
  system: ['stable'],
  messages: [{ role: 'user' as const, content: JSON.stringify({ kind: 'SMS' }) }],
  maxTokens: 100,
};

async function expectAiError(promise: Promise<unknown>, code: string, status: number): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(AiError);
  await promise.catch((err: AiError) => {
    expect(err.code).toBe(code);
    expect(err.getStatus()).toBe(status);
    expect(err.getResponse()).toMatchObject({ code });
  });
}

describe('AI key storage', () => {
  it('encrypts the key, keeps only the last four characters in clear and never returns it', async () => {
    const { state, settings } = setup();
    await settings.setKey('admin-1', API_KEY);
    const stored = String(state.settings?.encryptedApiKey);
    expect(stored).not.toContain(API_KEY);
    expect(stored).not.toContain('unit-test-key');
    expect(state.settings?.apiKeyLast4).toBe('WXYZ');
    expect(await settings.getActiveKey()).toEqual({ key: API_KEY, source: 'DATABASE' });

    const dto = await settings.toDTO('HEARTBEAT');
    expect(dto).toMatchObject({ configured: true, keySource: 'DATABASE', keyLast4: 'WXYZ' });
    expect(JSON.stringify(dto)).not.toContain(API_KEY);
    expect(JSON.stringify(state.audit)).not.toContain(API_KEY);
  });

  it('removes the key and falls back to ANTHROPIC_API_KEY', async () => {
    const { settings } = setup({}, { ANTHROPIC_API_KEY: 'sk-ant-env-fallback-key-9999ABCD' });
    await settings.setKey('admin-1', API_KEY);
    await settings.removeKey('admin-1');
    expect(await settings.getActiveKey()).toEqual({ key: 'sk-ant-env-fallback-key-9999ABCD', source: 'ENV' });
    const dto = await settings.toDTO('QUEUE');
    expect(dto).toMatchObject({ configured: true, keySource: 'ENV', keyLast4: 'ABCD', jobMode: 'QUEUE' });
  });

  it('is off without a stored or env key', async () => {
    const { settings, ai } = setup();
    expect((await settings.toDTO('HEARTBEAT')).configured).toBe(false);
    expect(await ai.isConfigured()).toBe(false);
  });

  it('refuses to store a key in production without an encryption key', async () => {
    const { settings } = setup({}, { NODE_ENV: 'production', INTEGRATION_ENCRYPTION_KEY: undefined });
    await expectAiError(settings.setKey('admin-1', API_KEY), 'AI_ENCRYPTION_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE);
  });
});

describe('AiService.run', () => {
  it('refuses every call while AI is not configured, without calling the provider', async () => {
    const { ai, adapter, state } = setup();
    await expectAiError(ai.run(request), 'AI_NOT_CONFIGURED', HttpStatus.SERVICE_UNAVAILABLE);
    expect(adapter.requests).toHaveLength(0);
    expect(state.usage).toHaveLength(0);
  });

  it('uses the configured model and meters tokens and cost', async () => {
    const { ai, settings, adapter, state } = setup();
    await settings.setKey('admin-1', API_KEY);
    const result = await ai.run(request);
    expect(adapter.requests[0].model).toBe('claude-sonnet-5');
    // 1200 x 2 + 300 x 10 + 0 x 2.5 + 800 x 0.2 micro-USD (claude-sonnet-5 list price)
    expect(result.costMicroUsd).toBe(5_560);
    expect(state.usage).toEqual([
      expect.objectContaining({
        studioId: STUDIO,
        task: 'COPYWRITING',
        model: 'claude-sonnet-5',
        inputTokens: 1200,
        outputTokens: 300,
        cacheReadTokens: 800,
        costMicroUsd: 5_560,
        success: true,
      }),
    ]);
  });

  it('applies price overrides and per-task models from the settings', async () => {
    const { ai, settings, adapter } = setup();
    await settings.setKey('admin-1', API_KEY);
    await settings.update('admin-1', {
      models: { COPYWRITING: 'claude-haiku-4-5' },
      priceOverrides: { 'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 1, cacheWritePerMTok: 1, cacheReadPerMTok: 1 } },
    });
    const result = await ai.run(request);
    expect(adapter.requests[0].model).toBe('claude-haiku-4-5');
    expect(result.costMicroUsd).toBe(1200 + 300 + 800);
  });

  it('blocks a tenant that reached its monthly budget (429) before calling the provider', async () => {
    const { ai, settings, adapter, state } = setup({ studioBudget: 1 });
    await settings.setKey('admin-1', API_KEY);
    state.usage.push({ studioId: STUDIO, costMicroUsd: 10_000 });
    await expectAiError(ai.run(request), 'AI_MONTHLY_LIMIT_REACHED', HttpStatus.TOO_MANY_REQUESTS);
    expect(adapter.requests).toHaveLength(0);
  });

  it('resolves the budget as override, then plan, then platform default; 0 turns AI off', async () => {
    const { usage } = setup({ studioBudget: null, planLimits: { aiMonthlyBudgetCents: 250 } });
    expect(await usage.resolveBudget(STUDIO)).toEqual({ cents: 250, source: 'PLAN', overrideCents: null });
    const fallback = setup({ studioBudget: null, planLimits: { maxStaff: 3 } });
    expect(await fallback.usage.resolveBudget(STUDIO)).toEqual({ cents: 500, source: 'DEFAULT', overrideCents: null });
    const override = setup({ studioBudget: 0, planLimits: { aiMonthlyBudgetCents: 250 } });
    expect(await override.usage.resolveBudget(STUDIO)).toEqual({ cents: 0, source: 'OVERRIDE', overrideCents: 0 });
    await override.settings.setKey('admin-1', API_KEY);
    await expectAiError(override.ai.run(request), 'AI_MONTHLY_LIMIT_REACHED', HttpStatus.TOO_MANY_REQUESTS);
  });

  it('platform jobs (no studio) are not limited by a tenant budget', async () => {
    const { ai, settings } = setup({ studioBudget: 0 });
    await settings.setKey('admin-1', API_KEY);
    await expect(ai.run({ ...request, task: 'TRANSLATION', studioId: null })).resolves.toMatchObject({ costMicroUsd: expect.any(Number) });
  });

  it('turns provider failures into typed errors and records them without cost', async () => {
    const { ai, settings, adapter, state } = setup();
    await settings.setKey('admin-1', API_KEY);
    adapter.failNext.push('AI_RATE_LIMITED');
    await expectAiError(ai.run(request), 'AI_RATE_LIMITED', HttpStatus.SERVICE_UNAVAILABLE);
    expect(state.usage).toEqual([expect.objectContaining({ success: false, errorCode: 'AI_RATE_LIMITED', costMicroUsd: 0 })]);
  });

  it('test connection reports a rejected key without throwing', async () => {
    const { ai, settings, state } = setup();
    await settings.setKey('admin-1', 'sk-ant-api03-this-key-is-invalid-0000');
    await expect(ai.testConnection('admin-1')).resolves.toEqual({ ok: false, errorCode: 'AI_AUTH_FAILED', model: 'claude-haiku-4-5-20251001' });
    expect(state.settings).toMatchObject({ lastTestOk: false, lastTestErrorCode: 'AI_AUTH_FAILED' });
    await settings.setKey('admin-1', API_KEY);
    await expect(ai.testConnection('admin-1')).resolves.toEqual({ ok: true, errorCode: null, model: 'claude-haiku-4-5-20251001' });
  });
});

describe('marketing budget', () => {
  const marketingRequest = { ...request, task: 'MARKETING_DRAFT' as const };

  it('defaults to 50 USD and is editable by the super admin setting', async () => {
    const { settings } = setup();
    expect(await settings.getMarketingBudgetCents()).toBe(5000);
    expect((await settings.toDTO('HEARTBEAT')).marketingAiMonthlyBudgetCents).toBe(5000);
    await settings.update('admin-1', { marketingAiMonthlyBudgetCents: 1200 });
    expect(await settings.getMarketingBudgetCents()).toBe(1200);
  });

  it('is enforced before every marketing call: 402 MARKETING_AI_BUDGET_EXCEEDED, provider never called', async () => {
    const { ai, settings, adapter, state } = setup();
    await settings.setKey('admin-1', API_KEY);
    await settings.update('admin-1', { marketingAiMonthlyBudgetCents: 1 });
    state.usage.push({ studioId: STUDIO, task: 'MARKETING_DRAFT', costMicroUsd: 10_000 });
    await expectAiError(ai.run(marketingRequest), 'MARKETING_AI_BUDGET_EXCEEDED', HttpStatus.PAYMENT_REQUIRED);
    expect(adapter.requests).toHaveLength(0);
  });

  it('a small tenant budget does not block the marketing studio, and marketing has its own cap', async () => {
    const { ai, settings, adapter, usage } = setup({ studioBudget: 1 });
    await settings.setKey('admin-1', API_KEY);
    await expect(ai.run(marketingRequest)).resolves.toMatchObject({ costMicroUsd: 5_560 });
    expect(adapter.requests).toHaveLength(1);
    const status = await usage.marketingStatus(STUDIO, true, new Date());
    expect(status).toMatchObject({ budgetCents: 5000, usedMicroUsd: 5_560, limitReached: false });
  });

  it('0 switches the marketing studio off', async () => {
    const { ai, settings, adapter } = setup();
    await settings.setKey('admin-1', API_KEY);
    await settings.update('admin-1', { marketingAiMonthlyBudgetCents: 0 });
    await expectAiError(ai.run(marketingRequest), 'MARKETING_AI_BUDGET_EXCEEDED', HttpStatus.PAYMENT_REQUIRED);
    expect(adapter.requests).toHaveLength(0);
  });

  it('the tenant budget still limits non-marketing tasks of the same studio', async () => {
    const { ai, settings } = setup({ studioBudget: 1 });
    await settings.setKey('admin-1', API_KEY);
    await settings.update('admin-1', { marketingAiMonthlyBudgetCents: 100 });
    await ai.run(marketingRequest);
    await ai.run(marketingRequest);
    await expectAiError(ai.run(request), 'AI_MONTHLY_LIMIT_REACHED', HttpStatus.TOO_MANY_REQUESTS);
  });
});

describe('toPlainText', () => {
  it('leaves no angle brackets behind, even from nested or split tags', () => {
    expect(toPlainText('<b>Merhaba</b> <scr<script>ipt>alert(1)</script>')).not.toMatch(/[<>]/);
    expect(toPlainText('  duz metin  ')).toBe('duz metin');
  });
});

describe('marketing daily cap (M3d)', () => {
  const marketingRequest = { ...request, task: 'MARKETING_DRAFT' as const };
  const DAY_MS = 86_400_000;

  it('has no daily limit without a cap', async () => {
    const { ai, settings, adapter } = setup({ aiDailyCapCents: null });
    await settings.setKey('admin-1', API_KEY);
    await ai.run(marketingRequest);
    await ai.run(marketingRequest);
    expect(adapter.requests).toHaveLength(2);
  });

  it('stops at the cap with 402 MARKETING_AI_DAILY_CAP_EXCEEDED before the provider is called', async () => {
    // 2 cents = 20_000 micro-USD; one fake call costs 5_560.
    const { ai, settings, adapter } = setup({ aiDailyCapCents: 2 });
    await settings.setKey('admin-1', API_KEY);
    for (let i = 0; i < 4; i++) await ai.run(marketingRequest);
    expect(adapter.requests).toHaveLength(4);
    await expectAiError(ai.run(marketingRequest), 'MARKETING_AI_DAILY_CAP_EXCEEDED', HttpStatus.PAYMENT_REQUIRED);
    expect(adapter.requests).toHaveLength(4);
  });

  it('counts only today (UTC): yesterday spend does not use the cap up, and the next day opens it again', async () => {
    const { ai, settings, state } = setup({ aiDailyCapCents: 1 });
    await settings.setKey('admin-1', API_KEY);
    const now = new Date('2026-10-05T12:00:00.000Z');
    state.usage.push({ studioId: STUDIO, task: 'MARKETING_DRAFT', costMicroUsd: 10_000, createdAt: new Date(now.getTime() - DAY_MS) });
    await expect(ai.run(marketingRequest, now)).resolves.toBeDefined();
    state.usage.push({ studioId: STUDIO, task: 'MARKETING_DRAFT', costMicroUsd: 10_000, createdAt: now });
    await expectAiError(ai.run(marketingRequest, now), 'MARKETING_AI_DAILY_CAP_EXCEEDED', HttpStatus.PAYMENT_REQUIRED);
    await expect(ai.run(marketingRequest, new Date(now.getTime() + DAY_MS))).resolves.toBeDefined();
  });

  it('a cap of 0 blocks the day, and the weekly summary task is counted like the other marketing tasks', async () => {
    const { ai, settings } = setup({ aiDailyCapCents: 0 });
    await settings.setKey('admin-1', API_KEY);
    await expectAiError(ai.run({ ...request, task: 'MARKETING_WEEKLY_SUMMARY' as const }), 'MARKETING_AI_DAILY_CAP_EXCEEDED', HttpStatus.PAYMENT_REQUIRED);
  });

  it('does not apply to the other tasks of the tenant', async () => {
    const { ai, settings } = setup({ aiDailyCapCents: 0 });
    await settings.setKey('admin-1', API_KEY);
    await expect(ai.run(request)).resolves.toBeDefined();
  });

  it('returns the id of the usage row of the call', async () => {
    const { ai, settings } = setup();
    await settings.setKey('admin-1', API_KEY);
    await expect(ai.run(marketingRequest)).resolves.toMatchObject({ usageId: expect.stringMatching(/^usage-/) });
  });
});
