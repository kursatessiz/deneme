import { ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { CheckInService } from './checkin.service';
import { DynamicQrNonceStore } from './dynamic-qr-nonce.store';
import { signDynamicQrToken } from './dynamic-qr-token';
import type { PrismaService } from '../prisma/prisma.service';
import type { SchedulesService } from '../schedules/schedules.service';

const SECRET = 'unit-secret-unit-secret-unit-secret-1234';
const STUDIO = 'studio-1';

describe('CheckInService.checkInByMemberQr nonce handling', () => {
  const candidate = (id: string) => ({ id, scheduleId: `s-${id}`, schedule: { title: id, startTime: new Date() } });
  const build = (candidates: ReturnType<typeof candidate>[]) => {
    const prisma = {
      studio: { findUniqueOrThrow: jest.fn().mockResolvedValue({ checkInWindowBeforeMinutes: 30, checkInWindowAfterMinutes: 30 }) },
      membership: {
        findFirst: jest.fn().mockResolvedValue({ id: 'ms-1', status: 'ACTIVE', studio: { isActive: true }, memberProfile: { id: 'mp-1' } }),
      },
      booking: {
        findFirst: jest.fn().mockResolvedValue({ id: 'b-1', schedule: { branchId: null } }),
      },
    };
    const schedules = {
      findCheckInCandidates: jest.fn().mockResolvedValue(candidates),
      checkInForMember: jest.fn().mockImplementation(async (_s: string, id: string) => ({ id, status: 'ATTENDED', checkInAt: new Date() })),
    };
    const config = { getOrThrow: jest.fn().mockReturnValue(SECRET) };
    const nonces = new DynamicQrNonceStore({ getClient: () => null } as never);
    const service = new CheckInService(
      prisma as unknown as PrismaService,
      schedules as unknown as SchedulesService,
      config as unknown as ConfigService,
      nonces,
    );
    return { service, schedules };
  };

  it('an ambiguous scan does not consume the token, the follow-up with a schedule checks in once', async () => {
    const { service, schedules } = build([candidate('a'), candidate('b')]);
    const { token } = signDynamicQrToken(SECRET, 'ms-1', STUDIO);

    const first = await service.checkInByMemberQr(STUDIO, null, token);
    expect(first.resolved).toBe(false);
    expect(schedules.checkInForMember).not.toHaveBeenCalled();

    const second = await service.checkInByMemberQr(STUDIO, null, token, 's-b');
    expect(second.resolved).toBe(true);
    expect(schedules.checkInForMember).toHaveBeenCalledTimes(1);

    // Replay protection still holds once a booking was checked in.
    await expect(service.checkInByMemberQr(STUDIO, null, token, 's-b')).rejects.toThrow(ConflictException);
    expect(schedules.checkInForMember).toHaveBeenCalledTimes(1);
  });

  it('a resolved single-candidate scan cannot be replayed', async () => {
    const { service } = build([candidate('only')]);
    const { token } = signDynamicQrToken(SECRET, 'ms-1', STUDIO);
    await expect(service.checkInByMemberQr(STUDIO, null, token)).resolves.toMatchObject({ resolved: true });
    await expect(service.checkInByMemberQr(STUDIO, null, token)).rejects.toThrow(ConflictException);
  });
});
