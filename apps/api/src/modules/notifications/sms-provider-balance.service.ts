import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { SmsNetgsmAdapter } from './channels/sms-netgsm.adapter';
import { SmsIletiMerkeziAdapter } from './channels/sms-iletimerkezi.adapter';

export interface SmsProviderBalanceResult {
  provider: 'MOCK' | 'NETGSM' | 'ILETI_MERKEZI';
  status: 'ok' | 'low_balance' | 'error' | 'skipped';
  credits: number | null;
  threshold: number;
  checkedAt: string;
  errorMessage?: string;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Polls the configured SMS provider's account balance, throttled to at most
 * once an hour (CLAUDE.md: "saatlik yoklanır, eşik altında uyarı"). Called
 * from the scheduler heartbeat (JobsService.runAll); this class owns the
 * throttling so repeated 15-minute heartbeats do not hammer the provider.
 * Below the threshold, it writes a platform-level AuditLog entry (no
 * dedicated alert channel exists yet, so this doubles as the log/audit
 * trail the backlog item asks for) and logs a warning.
 */
@Injectable()
export class SmsProviderBalanceService {
  private readonly logger = new Logger(SmsProviderBalanceService.name);
  private lastCheckedAt: number | null = null;
  private lastResult: SmsProviderBalanceResult | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly netgsm: SmsNetgsmAdapter,
    private readonly iletiMerkezi: SmsIletiMerkeziAdapter,
  ) {}

  /** Last computed result, for the system health endpoint. Never blocks. */
  getLastResult(): SmsProviderBalanceResult | null {
    return this.lastResult;
  }

  /**
   * Runs the check if more than an hour has passed since the last one (or
   * `force` is set, for tests). Returns the (possibly cached) result.
   */
  async checkIfDue(now = new Date(), force = false): Promise<SmsProviderBalanceResult> {
    if (!force && this.lastCheckedAt !== null && now.getTime() - this.lastCheckedAt < HOUR_MS) {
      return this.lastResult!;
    }
    return this.check(now);
  }

  async check(now = new Date()): Promise<SmsProviderBalanceResult> {
    const provider = this.config.get<'MOCK' | 'NETGSM' | 'ILETI_MERKEZI'>('SMS_PROVIDER', 'MOCK');
    const threshold = this.config.get<number>('SMS_PROVIDER_LOW_BALANCE_THRESHOLD', 500);

    let result: SmsProviderBalanceResult;
    if (provider === 'MOCK') {
      result = { provider, status: 'skipped', credits: null, threshold, checkedAt: now.toISOString() };
    } else {
      const adapter = provider === 'NETGSM' ? this.netgsm : this.iletiMerkezi;
      const balance = await adapter.getBalance();
      if (balance.credits === null) {
        result = {
          provider,
          status: 'error',
          credits: null,
          threshold,
          checkedAt: now.toISOString(),
          errorMessage: balance.errorMessage,
        };
      } else {
        result = {
          provider,
          status: balance.credits < threshold ? 'low_balance' : 'ok',
          credits: balance.credits,
          threshold,
          checkedAt: now.toISOString(),
        };
      }
    }

    this.lastCheckedAt = now.getTime();
    this.lastResult = result;

    if (result.status === 'low_balance') {
      this.logger.warn(
        `SMS provider ${result.provider} balance is low: ${result.credits} credits (threshold ${result.threshold})`,
      );
      await this.prisma.auditLog.create({
        data: {
          studioId: null,
          userId: null,
          action: 'sms_provider.low_balance_alert',
          entityType: 'SmsProviderBalance',
          entityId: result.provider,
          metadata: { credits: result.credits, threshold: result.threshold, checkedAt: result.checkedAt },
        },
      });
    } else if (result.status === 'error') {
      this.logger.error(`SMS provider ${result.provider} balance check failed: ${result.errorMessage}`);
    }

    return result;
  }
}
