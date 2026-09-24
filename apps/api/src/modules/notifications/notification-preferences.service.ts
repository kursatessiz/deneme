import { Injectable } from '@nestjs/common';
import {
  NOTIFICATION_CATEGORIES,
  NotificationCategory,
  NotificationPreferencesDTO,
  UpdateNotificationPreferencesInput,
  RegisterPushDeviceInput,
  resolveNotificationPreferences,
} from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationPreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<NotificationPreferencesDTO> {
    const [rows, isStaff] = await Promise.all([
      this.prisma.notificationPreference.findMany({ where: { userId } }),
      this.isTrainer(userId),
    ]);
    return { items: resolveNotificationPreferences(rows, { includeStaff: isStaff }) };
  }

  async update(userId: string, dto: UpdateNotificationPreferencesInput): Promise<NotificationPreferencesDTO> {
    const entries = Object.entries(dto.preferences) as [NotificationCategory, { push: boolean; sms: boolean }][];
    await this.prisma.$transaction(
      entries.map(([category, value]) =>
        this.prisma.notificationPreference.upsert({
          where: { userId_category: { userId, category } },
          create: { userId, category, push: value.push, sms: value.sms },
          update: { push: value.push, sms: value.sms },
        }),
      ),
    );
    return this.get(userId);
  }

  /** Effective channel settings used by the senders. */
  async channelsFor(userId: string, category: NotificationCategory): Promise<{ push: boolean; sms: boolean }> {
    const row = await this.prisma.notificationPreference.findUnique({
      where: { userId_category: { userId, category } },
    });
    return row ? { push: row.push, sms: row.sms } : { ...NOTIFICATION_CATEGORIES[category].defaults };
  }

  async registerDevice(userId: string, dto: RegisterPushDeviceInput): Promise<void> {
    // A token identifies an app install; whoever signs in last owns it.
    await this.prisma.pushDevice.upsert({
      where: { token: dto.token },
      create: { userId, token: dto.token, platform: dto.platform, deviceName: dto.deviceName ?? null },
      update: {
        userId,
        platform: dto.platform,
        deviceName: dto.deviceName ?? null,
        lastSeenAt: new Date(),
        disabledAt: null,
      },
    });
  }

  /** Only removes the caller's own device; unknown tokens are ignored. */
  async removeDevice(userId: string, token: string): Promise<void> {
    await this.prisma.pushDevice.deleteMany({ where: { userId, token } });
  }

  private async isTrainer(userId: string): Promise<boolean> {
    const count = await this.prisma.trainerProfile.count({
      where: { membership: { userId, status: 'ACTIVE' } },
    });
    return count > 0;
  }
}
