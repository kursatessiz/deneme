import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, string>;
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_BATCH_SIZE = 100;

interface ExpoTicket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/**
 * Sends push notifications through the Expo push service. In MOCK mode
 * nothing leaves the server. Tokens Expo reports as DeviceNotRegistered
 * are disabled so they are not retried.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly provider: 'MOCK' | 'EXPO';
  private readonly accessToken?: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.provider = config.get<'MOCK' | 'EXPO'>('PUSH_PROVIDER', 'MOCK');
    this.accessToken = config.get<string>('EXPO_ACCESS_TOKEN');
  }

  /** Returns the number of devices the message was handed to. */
  async sendToUser(userId: string, message: PushMessage): Promise<number> {
    const devices = await this.prisma.pushDevice.findMany({
      where: { userId, disabledAt: null },
      select: { token: true },
    });
    if (devices.length === 0) return 0;

    if (this.provider === 'MOCK') {
      this.logger.log(`[MOCK PUSH] user ${userId}, ${devices.length} device(s): ${message.title}`);
      return devices.length;
    }

    let delivered = 0;
    for (let i = 0; i < devices.length; i += EXPO_BATCH_SIZE) {
      const batch = devices.slice(i, i + EXPO_BATCH_SIZE);
      try {
        const response = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
          },
          body: JSON.stringify(
            batch.map((d) => ({
              to: d.token,
              title: message.title,
              body: message.body,
              data: message.data ?? {},
              sound: 'default',
              channelId: 'default',
            })),
          ),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
          this.logger.error(`Expo push HTTP ${response.status}`);
          continue;
        }
        const { data } = (await response.json()) as { data: ExpoTicket[] };
        const unregistered: string[] = [];
        data.forEach((ticket, index) => {
          if (ticket.status === 'ok') delivered += 1;
          else if (ticket.details?.error === 'DeviceNotRegistered') unregistered.push(batch[index].token);
          else this.logger.warn(`Expo push error: ${ticket.details?.error ?? ticket.message ?? 'unknown'}`);
        });
        if (unregistered.length > 0) {
          await this.prisma.pushDevice.updateMany({
            where: { token: { in: unregistered } },
            data: { disabledAt: new Date() },
          });
        }
      } catch (err) {
        this.logger.error(`Expo push request failed: ${(err as Error).message}`);
      }
    }
    return delivered;
  }
}
