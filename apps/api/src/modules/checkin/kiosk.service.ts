import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomInt } from 'crypto';
import type { CreateKioskDeviceInput } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { assertBranchAccess } from '../branches/branch-access';
import type { KioskTokenClaims } from './kiosk-context';

const PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // unambiguous, matches PairingCodeSchema
const PAIRING_CODE_LENGTH = 8;
const PAIRING_TTL_MS = 10 * 60 * 1000;
const KIOSK_TOKEN_TTL = '180d';

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

function generatePairingCode(): string {
  let code = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i += 1) {
    code += PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)];
  }
  return code;
}

@Injectable()
export class KioskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async createDevice(tenant: TenantContext, actor: AuthUser, dto: CreateKioskDeviceInput) {
    assertBranchAccess(tenant, dto.branchId);
    const branch = await this.prisma.branch.findFirst({ where: { id: dto.branchId, studioId: tenant.studioId } });
    if (!branch) throw new NotFoundException('Şube bulunamadı');

    const pairingCode = generatePairingCode();
    const device = await this.prisma.$transaction(async (tx) => {
      const created = await tx.kioskDevice.create({
        data: {
          studioId: tenant.studioId,
          branchId: dto.branchId,
          name: dto.name,
          pairingCodeHash: hashCode(pairingCode),
          pairingCodeExpiresAt: new Date(Date.now() + PAIRING_TTL_MS),
          createdByUserId: actor.id,
        },
      });
      await tx.auditLog.create({
        data: {
          studioId: tenant.studioId,
          userId: actor.id,
          action: 'kiosk.device.create',
          entityType: 'KioskDevice',
          entityId: created.id,
          metadata: { branchId: dto.branchId, name: dto.name },
        },
      });
      return created;
    });

    return {
      id: device.id,
      branchId: device.branchId,
      name: device.name,
      pairingCode,
      pairingCodeExpiresAt: device.pairingCodeExpiresAt,
    };
  }

  async listDevices(tenant: TenantContext) {
    const devices = await this.prisma.kioskDevice.findMany({
      where: { studioId: tenant.studioId, ...(tenant.branchIds ? { branchId: { in: [...tenant.branchIds] } } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return devices.map((d) => ({
      id: d.id,
      branchId: d.branchId,
      name: d.name,
      pairedAt: d.pairedAt,
      lastSeenAt: d.lastSeenAt,
      revokedAt: d.revokedAt,
      isPending: !d.pairedAt && !d.revokedAt,
    }));
  }

  async revokeDevice(tenant: TenantContext, actor: AuthUser, deviceId: string) {
    const device = await this.prisma.kioskDevice.findFirst({ where: { id: deviceId, studioId: tenant.studioId } });
    if (!device) throw new NotFoundException('Kiosk cihazı bulunamadı');
    assertBranchAccess(tenant, device.branchId);

    await this.prisma.$transaction(async (tx) => {
      await tx.kioskDevice.update({ where: { id: device.id }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({
        data: {
          studioId: tenant.studioId,
          userId: actor.id,
          action: 'kiosk.device.revoke',
          entityType: 'KioskDevice',
          entityId: device.id,
          metadata: {},
        },
      });
    });
    return { id: device.id, revoked: true };
  }

  /** Public exchange: a one-time human-typed code for a long-lived kiosk-scoped JWT. */
  async pair(pairingCode: string) {
    const device = await this.prisma.kioskDevice.findFirst({
      where: { pairingCodeHash: hashCode(pairingCode), pairedAt: null, revokedAt: null },
    });
    if (!device || !device.pairingCodeExpiresAt || device.pairingCodeExpiresAt <= new Date()) {
      throw new BadRequestException('Eşleştirme kodu geçersiz veya süresi doldu');
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.kioskDevice.updateMany({
        where: { id: device.id, pairedAt: null, revokedAt: null },
        data: { pairedAt: now, pairingCodeHash: null, pairingCodeExpiresAt: null, lastSeenAt: now },
      });
      if (claimed.count !== 1) throw new BadRequestException('Eşleştirme kodu geçersiz veya süresi doldu');
      await tx.auditLog.create({
        data: {
          studioId: device.studioId,
          userId: null,
          action: 'kiosk.device.pair',
          entityType: 'KioskDevice',
          entityId: device.id,
          metadata: { branchId: device.branchId },
        },
      });
    });

    const claims: KioskTokenClaims = { sub: device.id, typ: 'kiosk', studioId: device.studioId, branchId: device.branchId };
    const token = this.jwt.sign(claims, { expiresIn: KIOSK_TOKEN_TTL });
    return { token, studioId: device.studioId, branchId: device.branchId, deviceName: device.name };
  }
}
