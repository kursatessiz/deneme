import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { OtpPurpose } from '@platform/database';
import { AuthService, PIN_MAX_FAILURES } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from '../otp/otp.service';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(async () => 'hashed'),
  hashSync: jest.fn(() => 'dummy-hash'),
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const bcrypt = require('bcrypt');

describe('AuthService', () => {
  let service: AuthService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  const mockOtp = {
    issue: jest.fn(),
    verify: jest.fn(),
  };

  const mockJwt = {
    sign: jest.fn(() => 'signed-token'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: OtpService, useValue: mockOtp },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    // sessionUser() and issueTokens() hit prisma further; stub them out where unneeded.
    jest.spyOn(service, 'sessionUser').mockResolvedValue({} as any);
  });

  describe('requestLoginOtp', () => {
    it('calls otp.issue with deliver=false for an unknown phone and returns the generic body', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      const result = await service.requestLoginOtp('+905321110000', '1.2.3.4');

      expect(mockOtp.issue).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '+905321110000', purpose: OtpPurpose.LOGIN, deliver: false }),
      );
      expect(result).toEqual({ message: 'Numara kayıtlıysa doğrulama kodu gönderildi' });
    });

    it('returns the exact same body for a known, active phone (deliver=true)', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ isActive: true });

      const result = await service.requestLoginOtp('+905321112233', '1.2.3.4');

      expect(mockOtp.issue).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '+905321112233', purpose: OtpPurpose.LOGIN, deliver: true }),
      );
      expect(result).toEqual({ message: 'Numara kayıtlıysa doğrulama kodu gönderildi' });
    });

    it('does not deliver for an inactive user either', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ isActive: false });

      await service.requestLoginOtp('+905321112233', '1.2.3.4');

      expect(mockOtp.issue).toHaveBeenCalledWith(expect.objectContaining({ deliver: false }));
    });
  });

  describe('pinLogin', () => {
    const PHONE = '+905321112233';
    const PIN = '482916';

    it('unknown phone -> 401 with the same message as a wrong PIN', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(service.pinLogin(PHONE, PIN)).rejects.toThrow(UnauthorizedException);
      try {
        await service.pinLogin(PHONE, PIN);
      } catch (e: any) {
        expect(e.message).toBe('Telefon numarası veya PIN hatalı');
      }
      expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('user without a pinHash -> same 401 as wrong PIN', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'u1', pinHash: null, isActive: true });

      await expect(service.pinLogin(PHONE, PIN)).rejects.toThrow(UnauthorizedException);
    });

    it('locked user (reservation fails) -> 403', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'u1',
        pinHash: 'hash',
        isActive: true,
      });
      mockPrisma.user.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.pinLogin(PHONE, PIN)).rejects.toThrow(ForbiddenException);
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('5th consecutive failure sets pinLockedUntil', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'u1', pinHash: 'hash', isActive: true });
      mockPrisma.user.updateMany.mockResolvedValueOnce({ count: 1 }); // reservation ok
      bcrypt.compare.mockResolvedValueOnce(false);
      mockPrisma.user.findUniqueOrThrow.mockResolvedValueOnce({ failedPinAttempts: PIN_MAX_FAILURES });

      await expect(service.pinLogin(PHONE, PIN)).rejects.toThrow(UnauthorizedException);

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u1' },
          data: expect.objectContaining({ failedPinAttempts: 0, pinLockedUntil: expect.any(Date) }),
        }),
      );
    });

    it('a failure below the limit does not lock the account', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'u1', pinHash: 'hash', isActive: true });
      mockPrisma.user.updateMany.mockResolvedValueOnce({ count: 1 });
      bcrypt.compare.mockResolvedValueOnce(false);
      mockPrisma.user.findUniqueOrThrow.mockResolvedValueOnce({ failedPinAttempts: 2 });

      await expect(service.pinLogin(PHONE, PIN)).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('success resets the failure counters and issues tokens', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'u1', pinHash: 'hash', isActive: true });
      mockPrisma.user.updateMany.mockResolvedValueOnce({ count: 1 });
      bcrypt.compare.mockResolvedValueOnce(true);
      mockPrisma.user.update.mockResolvedValueOnce({});

      const result = await service.pinLogin(PHONE, PIN);

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u1' },
          data: { failedPinAttempts: 0, pinLockedUntil: null },
        }),
      );
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
    });
  });
});
