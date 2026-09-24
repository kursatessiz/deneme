import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from './push.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { TemplateService } from './templates/template.service';
import { ConsentService } from './consent/consent.service';
import { WhatsAppCloudAdapter } from './channels/whatsapp-cloud.adapter';
import { SmsNetgsmAdapter } from './channels/sms-netgsm.adapter';
import { SmsIletiMerkeziAdapter } from './channels/sms-iletimerkezi.adapter';

const mockPush = { sendToUser: jest.fn().mockResolvedValue(1) };
const mockPreferences = { channelsFor: jest.fn() };
const mockTemplates = { resolve: jest.fn(), render: jest.fn((body: string) => body) };
const mockConsents = { isGranted: jest.fn() };
const mockWhatsapp = { name: 'WHATSAPP' as const, send: jest.fn() };
const mockNetgsm = { name: 'SMS' as const, send: jest.fn() };
const mockIletiMerkezi = { name: 'SMS' as const, send: jest.fn() };

describe('NotificationsService', () => {
  let service: NotificationsService;

  const mockPrisma = {
    notificationLog: { create: jest.fn() },
    user: { findUnique: jest.fn() },
    studio: { findUnique: jest.fn() },
    smsWallet: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), updateMany: jest.fn() },
    smsTransaction: { create: jest.fn() },
  };

  function buildConfig(values: Record<string, string>) {
    return { get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback) };
  }

  async function build(configValues: Record<string, string>) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: buildConfig(configValues) },
        { provide: PushService, useValue: mockPush },
        { provide: NotificationPreferencesService, useValue: mockPreferences },
        { provide: TemplateService, useValue: mockTemplates },
        { provide: ConsentService, useValue: mockConsents },
        { provide: WhatsAppCloudAdapter, useValue: mockWhatsapp },
        { provide: SmsNetgsmAdapter, useValue: mockNetgsm },
        { provide: SmsIletiMerkeziAdapter, useValue: mockIletiMerkezi },
      ],
    }).compile();
    return module.get<NotificationsService>(NotificationsService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stores "[gizli icerik]" instead of the real message when sensitive: true', async () => {
    service = await build({ SMS_PROVIDER: 'MOCK', NODE_ENV: 'test' });

    await service.sendSms({
      studioId: null,
      phone: '+905321112233',
      message: 'Giris kodunuz: 482915. Kodu kimseyle paylasmayin.',
      type: 'LOGIN_OTP',
      sensitive: true,
    });

    expect(mockPrisma.notificationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ content: '[gizli icerik]' }),
      }),
    );
  });

  it('stores the real message when not sensitive', async () => {
    service = await build({ SMS_PROVIDER: 'MOCK', NODE_ENV: 'test' });

    await service.sendSms({
      studioId: 'studio-1',
      phone: '+905321112233',
      message: 'Yarınki dersiniz için hatırlatma',
      type: 'REMINDER',
      sensitive: false,
    });

    expect(mockPrisma.notificationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ content: 'Yarınki dersiniz için hatırlatma' }),
      }),
    );
  });

  describe('notifyUser', () => {
    it('sends only on the channels the user enabled for the category', async () => {
      const service = await build({ SMS_PROVIDER: 'MOCK' });
      mockPreferences.channelsFor.mockResolvedValueOnce({ push: false, sms: false });
      const result = await service.notifyUser({
        userId: 'u1',
        studioId: 's1',
        category: 'MARKETING',
        message: { title: 't', body: 'b' },
        smsText: 'sms',
      });
      expect(result).toEqual({ push: 0, sms: false });
      expect(mockPush.sendToUser).not.toHaveBeenCalled();
    });

    it('pushes when push is enabled and skips SMS without text', async () => {
      const service = await build({ SMS_PROVIDER: 'MOCK' });
      mockPreferences.channelsFor.mockResolvedValueOnce({ push: true, sms: true });
      const result = await service.notifyUser({
        userId: 'u1',
        studioId: 's1',
        category: 'BOOKING_REMINDER',
        message: { title: 't', body: 'b' },
      });
      expect(mockPush.sendToUser).toHaveBeenCalledWith('u1', { title: 't', body: 'b' });
      expect(result.sms).toBe(false);
    });
  });

  describe('send', () => {
    const baseParams = { studioId: 's1', userId: 'u1', category: 'BOOKING_REMINDER' as const, template: 'BOOKING_REMINDER', params: { firstName: 'Ada' } };

    beforeEach(() => {
      mockPreferences.channelsFor.mockResolvedValue({ push: true, sms: true });
      mockPrisma.user.findUnique.mockResolvedValue({ phone: '+905321112233' });
      mockPrisma.studio.findUnique.mockResolvedValue({ notificationSettings: { order: ['WHATSAPP', 'SMS'], whatsappEnabled: true } });
      mockTemplates.resolve.mockResolvedValue({ body: 'Merhaba {{firstName}}', whatsappTemplateName: 'wa_tpl', isTransactional: true });
      mockPrisma.smsWallet.findUnique.mockResolvedValue({ id: 'w1', studioId: 's1', balance: 5 });
      mockPrisma.smsWallet.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.smsWallet.findUniqueOrThrow.mockResolvedValue({ balance: 4 });
      mockPrisma.notificationLog.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'log1', ...data }));
    });

    it('sends WhatsApp first and never touches SMS when it succeeds', async () => {
      service = await build({ SMS_PROVIDER: 'MOCK' });
      mockWhatsapp.send.mockResolvedValueOnce({ success: true, providerMessageId: 'wa-1' });

      const result = await service.send(baseParams);

      expect(result).toEqual({ success: true, channel: 'WHATSAPP', providerMessageId: 'wa-1' });
      expect(mockNetgsm.send).not.toHaveBeenCalled();
      expect(mockPrisma.smsWallet.updateMany).not.toHaveBeenCalled();
    });

    it('falls back to SMS when WhatsApp fails', async () => {
      service = await build({ SMS_PROVIDER: 'MOCK' });
      mockWhatsapp.send.mockResolvedValueOnce({ success: false, errorMessage: 'wa down' });
      mockNetgsm.send.mockResolvedValueOnce({ success: true, providerMessageId: 'sms-1' });

      const result = await service.send(baseParams);

      expect(result).toEqual({ success: true, channel: 'SMS', providerMessageId: 'sms-1' });
      expect(mockNetgsm.send).toHaveBeenCalledTimes(1);
    });

    it('deducts one SMS credit only after a successful send', async () => {
      service = await build({ SMS_PROVIDER: 'MOCK' });
      mockWhatsapp.send.mockResolvedValueOnce({ success: false, errorMessage: 'wa down' });
      mockNetgsm.send.mockResolvedValueOnce({ success: true, providerMessageId: 'sms-1' });

      await service.send(baseParams);

      expect(mockPrisma.smsWallet.updateMany).toHaveBeenCalledWith({
        where: { studioId: 's1', balance: { gte: 1 } },
        data: { balance: { decrement: 1 } },
      });
      expect(mockPrisma.smsTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'USAGE', amount: -1 }) }),
      );
    });

    it('refunds the reserved credit and does not record a transaction when the SMS send fails', async () => {
      service = await build({ SMS_PROVIDER: 'MOCK' });
      mockWhatsapp.send.mockResolvedValueOnce({ success: false, errorMessage: 'wa down' });
      mockNetgsm.send.mockResolvedValueOnce({ success: false, errorMessage: 'sms down' });

      const result = await service.send(baseParams);

      expect(result.success).toBe(false);
      expect(mockPrisma.smsTransaction.create).not.toHaveBeenCalled();
      expect(mockPrisma.smsWallet.updateMany).toHaveBeenCalledWith({ where: { studioId: 's1' }, data: { balance: { increment: 1 } } });
    });

    it('does not attempt to send SMS when the wallet is empty', async () => {
      service = await build({ SMS_PROVIDER: 'MOCK' });
      mockWhatsapp.send.mockResolvedValueOnce({ success: false, errorMessage: 'wa down' });
      mockPrisma.smsWallet.updateMany.mockResolvedValueOnce({ count: 0 });

      const result = await service.send(baseParams);

      expect(result.success).toBe(false);
      expect(mockNetgsm.send).not.toHaveBeenCalled();
      expect(mockPrisma.notificationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ errorMessage: 'Stüdyo SMS kredisi yetersiz' }) }),
      );
    });

    it('blocks a non-transactional template without granted consent', async () => {
      service = await build({ SMS_PROVIDER: 'MOCK' });
      mockTemplates.resolve.mockResolvedValue({ body: 'Kampanya', whatsappTemplateName: 'wa_tpl', isTransactional: false });
      mockConsents.isGranted.mockResolvedValue(false);

      const result = await service.send({ ...baseParams, category: 'MARKETING', template: 'MARKETING_PROMO' });

      expect(result.success).toBe(false);
      expect(mockWhatsapp.send).not.toHaveBeenCalled();
      expect(mockNetgsm.send).not.toHaveBeenCalled();
    });

    it('sends a non-transactional template once consent is granted', async () => {
      service = await build({ SMS_PROVIDER: 'MOCK' });
      mockTemplates.resolve.mockResolvedValue({ body: 'Kampanya', whatsappTemplateName: 'wa_tpl', isTransactional: false });
      mockConsents.isGranted.mockResolvedValue(true);
      mockWhatsapp.send.mockResolvedValueOnce({ success: true, providerMessageId: 'wa-2' });

      const result = await service.send({ ...baseParams, category: 'MARKETING', template: 'MARKETING_PROMO' });

      expect(result).toEqual({ success: true, channel: 'WHATSAPP', providerMessageId: 'wa-2' });
    });
  });
});
