import { BadRequestException, Injectable } from '@nestjs/common';
import type { NotificationSettings, TopUpSmsWalletInput } from '@platform/shared';
import { parseNotificationSettings } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class NotificationSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings(studioId: string): Promise<NotificationSettings> {
    const studio = await this.prisma.studio.findUniqueOrThrow({
      where: { id: studioId },
      select: { notificationSettings: true },
    });
    return parseNotificationSettings(studio.notificationSettings);
  }

  async updateSettings(studioId: string, input: NotificationSettings): Promise<NotificationSettings> {
    await this.prisma.studio.update({ where: { id: studioId }, data: { notificationSettings: input as object } });
    return input;
  }

  async getWallet(studioId: string) {
    const wallet = await this.prisma.smsWallet.findUnique({ where: { studioId } });
    return { balance: wallet?.balance ?? 0, lowBalanceThreshold: wallet?.lowBalanceThreshold ?? 100 };
  }

  async listTransactions(studioId: string, take = 50) {
    return this.prisma.smsTransaction.findMany({
      where: { studioId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  /** Super admin manual credit top-up (or deduction with a negative amount). */
  async topUp(actorUserId: string, input: TopUpSmsWalletInput) {
    const wallet = await this.prisma.smsWallet.upsert({
      where: { studioId: input.studioId },
      create: { studioId: input.studioId, balance: 0 },
      update: {},
    });
    const newBalance = wallet.balance + input.credits;
    if (newBalance < 0) {
      throw new BadRequestException('Bakiye negatif olamaz');
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.smsWallet.update({ where: { id: wallet.id }, data: { balance: newBalance } });
      const transaction = await tx.smsTransaction.create({
        data: {
          studioId: input.studioId,
          walletId: wallet.id,
          type: 'ADJUSTMENT',
          amount: input.credits,
          balanceAfter: updated.balance,
          createdByUserId: actorUserId,
          note: input.note,
        },
      });
      return { wallet: updated, transaction };
    });
  }
}
