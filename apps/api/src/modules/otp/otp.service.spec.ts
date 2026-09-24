import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OtpPurpose } from '@platform/database';
import { OtpService, OTP_MAX_ATTEMPTS, OTP_MAX_PER_IP, OTP_MAX_PER_PHONE, TooManyRequestsException } from './otp.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('OtpService', () => {
  let service: OtpService;

  const mockPrisma = {
    otpChallenge: {
      count: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
  };

  const mockNotifications = {
    sendSms: jest.fn(),
  };

  const mockConfig = {
    getOrThrow: jest.fn((key: string) => {
      if (key === 'JWT_SECRET') return 'unit-test-jwt-secret-0123456789abcdef';
      throw new Error(`unexpected getOrThrow(${key})`);
    }),
    get: jest.fn((key: string) => (key === 'OTP_TEST_CODE' ? undefined : undefined)),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((ops: any[]) => Promise.all(ops));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<OtpService>(OtpService);
  });

  const issueParams = (overrides: Partial<Parameters<OtpService['issue']>[0]> = {}) => ({
    phone: '+905321112233',
    purpose: OtpPurpose.LOGIN,
    ip: '127.0.0.1',
    deliver: true,
    studioId: null,
    message: (code: string) => `code: ${code}`,
    ...overrides,
  });

  describe('issue', () => {
    it('rejects when the per-phone limit is hit', async () => {
      mockPrisma.otpChallenge.count.mockResolvedValueOnce(OTP_MAX_PER_PHONE); // phone count
      mockPrisma.otpChallenge.count.mockResolvedValueOnce(0); // ip count
      mockPrisma.otpChallenge.findFirst.mockResolvedValueOnce(null);

      await expect(service.issue(issueParams())).rejects.toThrow(TooManyRequestsException);
      expect(mockPrisma.otpChallenge.create).not.toHaveBeenCalled();
      expect(mockNotifications.sendSms).not.toHaveBeenCalled();
    });

    it('rejects when the per-IP limit is hit', async () => {
      mockPrisma.otpChallenge.count.mockResolvedValueOnce(0); // phone count
      mockPrisma.otpChallenge.count.mockResolvedValueOnce(OTP_MAX_PER_IP); // ip count
      mockPrisma.otpChallenge.findFirst.mockResolvedValueOnce(null);

      await expect(service.issue(issueParams())).rejects.toThrow(TooManyRequestsException);
      expect(mockPrisma.otpChallenge.create).not.toHaveBeenCalled();
    });

    it('rejects within the resend cooldown', async () => {
      mockPrisma.otpChallenge.count.mockResolvedValueOnce(0);
      mockPrisma.otpChallenge.count.mockResolvedValueOnce(0);
      mockPrisma.otpChallenge.findFirst.mockResolvedValueOnce({ createdAt: new Date() });

      await expect(service.issue(issueParams())).rejects.toThrow(TooManyRequestsException);
      expect(mockPrisma.otpChallenge.create).not.toHaveBeenCalled();
    });

    it('stores only a hash of the code, never the code itself', async () => {
      mockPrisma.otpChallenge.count.mockResolvedValueOnce(0);
      mockPrisma.otpChallenge.count.mockResolvedValueOnce(0);
      mockPrisma.otpChallenge.findFirst.mockResolvedValueOnce(null);
      mockPrisma.otpChallenge.updateMany.mockResolvedValueOnce({ count: 0 });
      mockPrisma.otpChallenge.create.mockResolvedValueOnce({});

      await service.issue(issueParams());

      const createCall = mockPrisma.otpChallenge.create.mock.calls[0][0];
      const stored = createCall.data.codeHash as string;
      expect(stored).toMatch(/^[0-9a-f]{64}$/);
      // The plaintext code sent in the message is never embedded in the hash payload.
      expect(createCall.data).not.toHaveProperty('code');
    });

    it('does not send an SMS when deliver is false', async () => {
      mockPrisma.otpChallenge.count.mockResolvedValueOnce(0);
      mockPrisma.otpChallenge.count.mockResolvedValueOnce(0);
      mockPrisma.otpChallenge.findFirst.mockResolvedValueOnce(null);
      mockPrisma.otpChallenge.updateMany.mockResolvedValueOnce({ count: 0 });
      mockPrisma.otpChallenge.create.mockResolvedValueOnce({});

      await service.issue(issueParams({ deliver: false }));

      expect(mockNotifications.sendSms).not.toHaveBeenCalled();
    });

    it('sends the SMS with sensitive: true when deliver is true', async () => {
      mockPrisma.otpChallenge.count.mockResolvedValueOnce(0);
      mockPrisma.otpChallenge.count.mockResolvedValueOnce(0);
      mockPrisma.otpChallenge.findFirst.mockResolvedValueOnce(null);
      mockPrisma.otpChallenge.updateMany.mockResolvedValueOnce({ count: 0 });
      mockPrisma.otpChallenge.create.mockResolvedValueOnce({});

      await service.issue(issueParams({ deliver: true }));

      expect(mockNotifications.sendSms).toHaveBeenCalledWith(
        expect.objectContaining({ sensitive: true, phone: '+905321112233' }),
      );
    });
  });

  describe('verify', () => {
    const CHALLENGE_ID = 'challenge-1';
    const CODE = '123456';

    function hashFor(purpose: OtpPurpose, phone: string, code: string): string {
      // Mirrors the service's private hash() with the same test JWT_SECRET.
      const { createHmac } = require('crypto');
      const key = createHmac('sha256', 'unit-test-jwt-secret-0123456789abcdef').update('otp-v1').digest();
      return createHmac('sha256', key).update(`${purpose}:${phone}:${code}`).digest('hex');
    }

    it('returns false when there is no open challenge', async () => {
      mockPrisma.otpChallenge.findFirst.mockResolvedValueOnce(null);
      await expect(service.verify('+905321112233', OtpPurpose.LOGIN, CODE)).resolves.toBe(false);
      expect(mockPrisma.otpChallenge.updateMany).not.toHaveBeenCalled();
    });

    it('returns false when the attempt reservation fails (updateMany count 0)', async () => {
      mockPrisma.otpChallenge.findFirst.mockResolvedValueOnce({
        id: CHALLENGE_ID,
        attempts: OTP_MAX_ATTEMPTS,
        codeHash: hashFor(OtpPurpose.LOGIN, '+905321112233', CODE),
      });
      mockPrisma.otpChallenge.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.verify('+905321112233', OtpPurpose.LOGIN, CODE)).resolves.toBe(false);
      // No further consuming update should have happened.
      expect(mockPrisma.otpChallenge.updateMany).toHaveBeenCalledTimes(1);
    });

    it('a code issued for LOGIN does not verify for INVITE', async () => {
      mockPrisma.otpChallenge.findFirst.mockResolvedValueOnce({
        id: CHALLENGE_ID,
        attempts: 0,
        codeHash: hashFor(OtpPurpose.LOGIN, '+905321112233', CODE),
      });
      mockPrisma.otpChallenge.updateMany.mockResolvedValueOnce({ count: 1 });

      const ok = await service.verify('+905321112233', OtpPurpose.INVITE, CODE);
      expect(ok).toBe(false);
    });

    it('a code issued for one phone does not verify for another phone', async () => {
      mockPrisma.otpChallenge.findFirst.mockResolvedValueOnce({
        id: CHALLENGE_ID,
        attempts: 0,
        codeHash: hashFor(OtpPurpose.LOGIN, '+905321112233', CODE),
      });
      mockPrisma.otpChallenge.updateMany.mockResolvedValueOnce({ count: 1 });

      const ok = await service.verify('+905321119999', OtpPurpose.LOGIN, CODE);
      expect(ok).toBe(false);
    });

    it('wrong code increments attempts but does not burn the challenge before the limit', async () => {
      mockPrisma.otpChallenge.findFirst.mockResolvedValueOnce({
        id: CHALLENGE_ID,
        attempts: 1,
        codeHash: hashFor(OtpPurpose.LOGIN, '+905321112233', CODE),
      });
      mockPrisma.otpChallenge.updateMany.mockResolvedValueOnce({ count: 1 }); // attempt reservation

      const ok = await service.verify('+905321112233', OtpPurpose.LOGIN, '000000');
      expect(ok).toBe(false);
      // Only the attempt-reservation update; the challenge is not consumed yet.
      expect(mockPrisma.otpChallenge.updateMany).toHaveBeenCalledTimes(1);
    });

    it('burns the challenge on the 5th wrong attempt', async () => {
      mockPrisma.otpChallenge.findFirst.mockResolvedValueOnce({
        id: CHALLENGE_ID,
        attempts: OTP_MAX_ATTEMPTS - 1,
        codeHash: hashFor(OtpPurpose.LOGIN, '+905321112233', CODE),
      });
      mockPrisma.otpChallenge.updateMany
        .mockResolvedValueOnce({ count: 1 }) // attempt reservation succeeds
        .mockResolvedValueOnce({ count: 1 }); // burn (consumedAt set)

      const ok = await service.verify('+905321112233', OtpPurpose.LOGIN, '000000');
      expect(ok).toBe(false);
      expect(mockPrisma.otpChallenge.updateMany).toHaveBeenCalledTimes(2);
      expect(mockPrisma.otpChallenge.updateMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: { id: CHALLENGE_ID },
          data: expect.objectContaining({ consumedAt: expect.any(Date) }),
        }),
      );
    });

    it('correct code but a losing race to consume returns false (single use)', async () => {
      mockPrisma.otpChallenge.findFirst.mockResolvedValueOnce({
        id: CHALLENGE_ID,
        attempts: 0,
        codeHash: hashFor(OtpPurpose.LOGIN, '+905321112233', CODE),
      });
      mockPrisma.otpChallenge.updateMany
        .mockResolvedValueOnce({ count: 1 }) // attempt reservation
        .mockResolvedValueOnce({ count: 0 }); // consume loses the race

      const ok = await service.verify('+905321112233', OtpPurpose.LOGIN, CODE);
      expect(ok).toBe(false);
    });

    it('correct code succeeds and consumes the challenge', async () => {
      mockPrisma.otpChallenge.findFirst.mockResolvedValueOnce({
        id: CHALLENGE_ID,
        attempts: 0,
        codeHash: hashFor(OtpPurpose.LOGIN, '+905321112233', CODE),
      });
      mockPrisma.otpChallenge.updateMany
        .mockResolvedValueOnce({ count: 1 }) // attempt reservation
        .mockResolvedValueOnce({ count: 1 }); // consume succeeds

      const ok = await service.verify('+905321112233', OtpPurpose.LOGIN, CODE);
      expect(ok).toBe(true);
    });
  });
});
