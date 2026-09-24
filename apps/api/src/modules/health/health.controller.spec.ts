import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

describe('HealthController', () => {
  let controller: HealthController;
  let prisma: PrismaService;

  const mockPrisma = {
    $queryRaw: jest.fn(),
  };

  const mockRedis = {
    isConfigured: true,
    ping: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        { provide: RedisService, useValue: mockRedis },
        { provide: ConfigService, useValue: { get: (_k: string, d?: string) => d } },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should return status ok when database is responsive', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ '1': 1 }]);

    const mockResponse: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await controller.check(mockResponse);

    expect(mockResponse.status).toHaveBeenCalledWith(200);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ok',
        database: expect.objectContaining({
          status: 'ok',
        }),
      }),
    );
  });

  it('should return degraded status (503) when database query fails', async () => {
    mockPrisma.$queryRaw.mockRejectedValueOnce(new Error('Connection timeout'));

    const mockResponse: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await controller.check(mockResponse);

    expect(mockResponse.status).toHaveBeenCalledWith(503);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'degraded',
      }),
    );
  });

  it('should return 503 when Redis is configured but unreachable', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ '1': 1 }]);
    mockRedis.ping.mockResolvedValueOnce(false);

    const mockResponse: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await controller.check(mockResponse);

    expect(mockResponse.status).toHaveBeenCalledWith(503);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({ redis: { status: 'error' } }),
    );
  });

  it('should not leak internal error messages', async () => {
    mockPrisma.$queryRaw.mockRejectedValueOnce(new Error('password authentication failed for user admin'));

    const mockResponse: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await controller.check(mockResponse);

    const body = JSON.stringify(mockResponse.json.mock.calls[0][0]);
    expect(body).not.toContain('password');
  });
});
