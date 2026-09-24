import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ConsentService } from './consent.service';
import { IysClientAdapter } from './iys-client.adapter';

describe('ConsentService', () => {
  let service: ConsentService;

  const mockPrisma = {
    communicationConsent: { findUnique: jest.fn(), findMany: jest.fn(), upsert: jest.fn() },
  };
  const mockIys = { syncConsent: jest.fn().mockResolvedValue({ success: true, transactionId: 'tx1' }) };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConsentService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: IysClientAdapter, useValue: mockIys },
      ],
    }).compile();
    service = module.get(ConsentService);
  });

  it('isGranted is false when no row exists', async () => {
    mockPrisma.communicationConsent.findUnique.mockResolvedValue(null);
    expect(await service.isGranted('s1', 'u1', 'SMS')).toBe(false);
  });

  it('isGranted is true only for a GRANTED status row', async () => {
    mockPrisma.communicationConsent.findUnique.mockResolvedValue({ status: 'GRANTED' });
    expect(await service.isGranted('s1', 'u1', 'SMS')).toBe(true);

    mockPrisma.communicationConsent.findUnique.mockResolvedValue({ status: 'REVOKED' });
    expect(await service.isGranted('s1', 'u1', 'SMS')).toBe(false);
  });

  it('setOwn upserts a GRANTED row with grantedAt set and revokedAt cleared', async () => {
    mockPrisma.communicationConsent.upsert.mockResolvedValue({});
    mockPrisma.communicationConsent.findMany.mockResolvedValue([]);
    mockPrisma.communicationConsent.findUnique.mockResolvedValue(null);

    await service.setOwn('s1', 'u1', { channel: 'SMS', granted: true });

    expect(mockPrisma.communicationConsent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: 'GRANTED', revokedAt: null }),
        update: expect.objectContaining({ status: 'GRANTED', revokedAt: null }),
      }),
    );
  });

  it('setOwn revocation sets REVOKED immediately', async () => {
    mockPrisma.communicationConsent.upsert.mockResolvedValue({});
    mockPrisma.communicationConsent.findMany.mockResolvedValue([]);
    mockPrisma.communicationConsent.findUnique.mockResolvedValue(null);

    await service.setOwn('s1', 'u1', { channel: 'WHATSAPP', granted: false });

    expect(mockPrisma.communicationConsent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: 'REVOKED', grantedAt: null }),
        update: expect.objectContaining({ status: 'REVOKED' }),
      }),
    );
  });
});
