import { Injectable, Logger } from '@nestjs/common';
import type { SystemHealthDTO } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { JobsService } from '../jobs/jobs.service';
import { SmsProviderBalanceService } from '../notifications/sms-provider-balance.service';

@Injectable()
export class AdminHealthService {
  private readonly logger = new Logger(AdminHealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly jobs: JobsService,
    private readonly smsBalance: SmsProviderBalanceService,
  ) {}

  async getHealth(): Promise<SystemHealthDTO> {
    const dbStart = Date.now();
    let database: SystemHealthDTO['database'] = { status: 'ok', latencyMs: 0 };
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = { status: 'ok', latencyMs: Date.now() - dbStart };
    } catch (err) {
      this.logger.error(`Admin health DB check failed: ${(err as Error).message}`);
      database = { status: 'error', latencyMs: Date.now() - dbStart };
    }

    let redis: SystemHealthDTO['redis'] = { status: 'not_configured' };
    if (this.redis.isConfigured) {
      redis = { status: (await this.redis.ping()) ? 'ok' : 'error' };
    }

    const [queueDepth, failedWebhookDeliveries] = await Promise.all([
      this.jobs.getQueueDepth(),
      this.prisma.webhookDelivery.count({ where: { status: 'FAILED' } }),
    ]);

    const lastRunAt = this.jobs.getLastRunAt();
    const smsResult = this.smsBalance.getLastResult();

    return {
      database,
      redis,
      queueDepth,
      lastHeartbeatRunAt: lastRunAt ? lastRunAt.toISOString() : null,
      failedWebhookDeliveries,
      smsProvider: smsResult
        ? {
            provider: smsResult.provider,
            status: smsResult.status,
            credits: smsResult.credits,
            threshold: smsResult.threshold,
            checkedAt: smsResult.checkedAt,
          }
        : null,
    };
  }
}
