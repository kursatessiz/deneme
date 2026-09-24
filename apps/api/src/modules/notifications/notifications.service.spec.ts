import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';

describe('NotificationsService', () => {
  let service: NotificationsService;

  const mockPrisma = {
    notificationLog: { create: jest.fn() },
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
});
