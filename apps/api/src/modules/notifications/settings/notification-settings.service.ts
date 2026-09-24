import { BadRequestException, NotFoundException, Injectable } from '@nestjs/common';
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
    const studio = await this.prisma.studio.findUnique({ where: { id: input.studioId }, select: { id: true } });
    if (!studio) throw new NotFoundException('İşletme bulunamadı');

    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.smsWallet.upsert({
        where: { studioId: input.studioId },
        create: { studioId: input.studioId, balance: 0 },
        update: {},
      });
      // Relative, guarded change: a send that deducts a credit concurrently is
      // never overwritten, and a deduction can never push the balance below zero.
      const changed = await tx.smsWallet.updateMany({
        where: { id: wallet.id, balance: { gte: Math.max(0, -input.credits) } },
        data: { balance: { increment: input.credits } },
      });
      if (changed.count === 0) {
        throw new BadRequestException('Bakiye negatif olamaz');
      }
      const updated = await tx.smsWallet.findUniqueOrThrow({ where: { id: wallet.id } });
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
      await tx.auditLog.create({
        data: {
          studioId: input.studioId,
          userId: actorUserId,
          action: 'sms_wallet.top_up',
          entityType: 'SmsWallet',
          entityId: wallet.id,
          metadata: { credits: input.credits, balanceAfter: updated.balance, note: input.note ?? null },
        },
      });
      return { wallet: updated, transaction };
    });
  }
}
