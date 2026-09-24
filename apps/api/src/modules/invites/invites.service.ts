import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { AcceptInviteInput, CreateInviteInput } from '@platform/shared';
import { DocumentType, InviteChannel, OtpPurpose, Prisma } from '@platform/database';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from '../otp/otp.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthService } from '../auth/auth.service';
import type { AuthUser, TenantContext } from '../auth/tenant-context';
import { PlanLimitsService } from '../admin/plan-limits.service';

export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;
/** Documents a person must accept to join a studio (latest published version). */
export const REQUIRED_DOCUMENTS: DocumentType[] = [DocumentType.KVKK_NOTICE, DocumentType.MEMBERSHIP_CONTRACT];
const INVALID_INVITE = 'Davet bulunamadı, süresi dolmuş veya daha önce kullanılmış';

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function maskPhone(phone: string): string {
  return phone.length > 6 ? `${phone.slice(0, 6)}*****${phone.slice(-2)}` : '*****';
}

@Injectable()
export class InvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly notifications: NotificationsService,
    private readonly auth: AuthService,
    private readonly config: ConfigService,
    private readonly planLimits: PlanLimitsService,
  ) {}

  async create(tenant: TenantContext, creator: AuthUser, dto: CreateInviteInput) {
    if (dto.roleKey === 'owner') {
      throw new ForbiddenException('İşletme sahibi rolü davet ile verilemez');
    }
    const required = dto.roleKey === 'member' ? 'members.manage' : 'staff.manage';
    if (!tenant.permissions.has(required)) {
      throw new ForbiddenException('Bu rol için davet oluşturma yetkiniz yok');
    }
    await this.planLimits.assertWithinLimit(tenant.studioId, dto.roleKey === 'member' ? 'maxActiveMembers' : 'maxStaff');

    const role = await this.prisma.roleTemplate.findUnique({
      where: { studioId_key: { studioId: tenant.studioId, key: dto.roleKey } },
    });
    if (!role || role.isOwner) throw new BadRequestException('Rol bulunamadı');

    const existing = await this.prisma.membership.findFirst({
      where: { studioId: tenant.studioId, status: 'ACTIVE', user: { phone: dto.phone } },
      select: { id: true },
    });
    if (existing) throw new ConflictException('Bu telefon numarası işletmede zaten aktif');

    return this.buildInvite(tenant.studioId, creator.id, role.id, dto.phone, dto.fullName, dto.channel);
  }

  /**
   * Super-admin path (backlog 4.1): a new tenant's owner cannot self-invite
   * (there is no staff member yet to invite them), so the admin tenant
   * creation flow issues the owner invite directly, skipping the
   * staff-facing role/permission checks in create() above.
   */
  async createOwnerInvite(studioId: string, creatorUserId: string, ownerRoleTemplateId: string, phone: string, fullName: string, channel: InviteChannel) {
    return this.buildInvite(studioId, creatorUserId, ownerRoleTemplateId, phone, fullName, channel);
  }

  private async buildInvite(
    studioId: string,
    creatorUserId: string,
    roleTemplateId: string,
    phone: string,
    fullName: string,
    channel: InviteChannel,
  ) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const invite = await this.prisma.$transaction(async (tx) => {
      // Only the newest invite for a person stays usable.
      await tx.inviteToken.updateMany({
        where: { studioId, phone, usedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return tx.inviteToken.create({
        data: {
          studioId,
          createdByUserId: creatorUserId,
          roleTemplateId,
          phone,
          fullName,
          tokenHash: hashInviteToken(token),
          channel,
          expiresAt,
        },
        include: { studio: { select: { name: true } } },
      });
    });

    const inviteUrl = `${this.config.getOrThrow<string>('PUBLIC_APP_URL').replace(/\/$/, '')}/j/${token}`;

    if (channel !== InviteChannel.SHOWN) {
      // WhatsApp Cloud API is not wired yet (backlog 1.6); SMS carries both.
      await this.notifications.sendSms({
        studioId,
        phone,
        message: `${invite.studio.name} sizi davet ediyor: ${inviteUrl}`,
        type: 'INVITE_LINK',
        sensitive: true,
      });
    }

    // The token is returned once, for the QR code; only its hash is stored.
    return { id: invite.id, inviteUrl, token, expiresAt, channel: invite.channel };
  }

  async preview(token: string) {
    const invite = await this.findUsable(token);
    const documents = await this.requiredDocuments(invite.studioId);
    return {
      studio: { name: invite.studio.name, logoUrl: invite.studio.logoUrl },
      fullName: invite.fullName,
      phoneMasked: maskPhone(invite.phone),
      roleName: invite.roleTemplate.name,
      expiresAt: invite.expiresAt,
      documents: documents.map((d) => ({ id: d.id, type: d.type, title: d.title, version: d.version, body: d.body })),
    };
  }

  async requestOtp(token: string, ip: string | null) {
    const invite = await this.findUsable(token);
    await this.otp.issue({
      phone: invite.phone,
      purpose: OtpPurpose.INVITE,
      ip,
      deliver: true,
      studioId: invite.studioId,
      message: (code) => `${invite.studio.name} daveti icin dogrulama kodunuz: ${code}`,
    });
    return { message: 'Doğrulama kodu gönderildi', phoneMasked: maskPhone(invite.phone) };
  }

  async accept(token: string, dto: AcceptInviteInput, ip: string | null) {
    const invite = await this.findUsable(token);

    const documents = await this.requiredDocuments(invite.studioId);
    const accepted = new Set(dto.acceptedDocumentVersionIds);
    if (documents.some((d) => !accepted.has(d.id))) {
      throw new BadRequestException('Devam etmek için sözleşme ve KVKK metinlerini onaylamanız gerekir');
    }

    if (!(await this.otp.verify(invite.phone, OtpPurpose.INVITE, dto.code))) {
      throw new UnauthorizedException('Kod geçersiz veya süresi dolmuş');
    }

    const existingUser = await this.prisma.user.findUnique({ where: { phone: invite.phone } });
    if (!existingUser?.pinHash && !dto.pin) {
      throw new BadRequestException('Uygulamaya giriş için bir PIN belirleyin');
    }
    const pinHash = dto.pin ? await bcrypt.hash(dto.pin, 10) : undefined;
    const [firstName, ...rest] = invite.fullName.trim().split(/\s+/);
    const lastName = rest.join(' ') || '-';
    const now = new Date();

    const userId = await this.prisma.$transaction(async (tx) => {
      // Single use: exactly one request can claim the invite.
      const claimed = await tx.inviteToken.updateMany({
        where: { id: invite.id, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) throw new GoneException(INVALID_INVITE);

      const user = await tx.user.upsert({
        where: { phone: invite.phone },
        create: { phone: invite.phone, firstName, lastName, pinHash, phoneVerifiedAt: now },
        update: { phoneVerifiedAt: now, ...(pinHash ? { pinHash, failedPinAttempts: 0, pinLockedUntil: null } : {}) },
      });

      const current = await tx.membership.findUnique({
        where: { userId_studioId: { userId: user.id, studioId: invite.studioId } },
      });
      if (current?.status === 'ACTIVE') throw new ConflictException('Bu işletmede zaten aktif üyeliğiniz var');

      // Completing real onboarding always promotes a partner-guest
      // membership to a real member (the flag is cleared, the row is
      // reused rather than duplicated).
      const membership = current
        ? await tx.membership.update({
            where: { id: current.id },
            data: { status: 'ACTIVE', roleTemplateId: invite.roleTemplateId, joinedAt: now, isPartnerGuest: false },
          })
        : await tx.membership.create({
            data: {
              userId: user.id,
              studioId: invite.studioId,
              roleTemplateId: invite.roleTemplateId,
              status: 'ACTIVE',
              joinedAt: now,
            },
          });

      if (invite.roleTemplate.key === 'member') {
        await tx.memberProfile.upsert({
          where: { membershipId: membership.id },
          create: { membershipId: membership.id, studioId: invite.studioId },
          update: {},
        });
      } else if (invite.roleTemplate.key === 'trainer') {
        await tx.trainerProfile.upsert({
          where: { membershipId: membership.id },
          create: { membershipId: membership.id, studioId: invite.studioId },
          update: {},
        });
      }

      await tx.consent.createMany({
        data: documents.map((d) => ({
          membershipId: membership.id,
          documentVersionId: d.id,
          acceptedAt: now,
          device: dto.device ?? null,
          ip,
        })),
        skipDuplicates: true,
      });

      await tx.auditLog.create({
        data: {
          studioId: invite.studioId,
          userId: user.id,
          action: 'INVITE_ACCEPTED',
          entityType: 'Membership',
          entityId: membership.id,
          metadata: { inviteId: invite.id, role: invite.roleTemplate.key } as Prisma.InputJsonValue,
        },
      });
      return user.id;
    });

    const tokens = await this.auth.issueTokens(userId);
    return { ...tokens, user: await this.auth.sessionUser(userId) };
  }

  private async findUsable(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new NotFoundException(INVALID_INVITE);
    const invite = await this.prisma.inviteToken.findUnique({
      where: { tokenHash: hashInviteToken(token) },
      include: {
        studio: { select: { name: true, logoUrl: true, isActive: true } },
        roleTemplate: { select: { key: true, name: true } },
      },
    });
    if (
      !invite ||
      invite.usedAt ||
      invite.revokedAt ||
      invite.expiresAt <= new Date() ||
      !invite.studio.isActive
    ) {
      throw new NotFoundException(INVALID_INVITE);
    }
    return invite;
  }

  /** Latest published version per required type; studio text wins over the platform text. */
  private async requiredDocuments(studioId: string) {
    const docs = await this.prisma.documentVersion.findMany({
      where: {
        type: { in: REQUIRED_DOCUMENTS },
        publishedAt: { not: null, lte: new Date() },
        OR: [{ studioId }, { studioId: null }],
      },
      orderBy: [{ version: 'desc' }],
    });
    return REQUIRED_DOCUMENTS.map(
      (type) => docs.find((d) => d.type === type && d.studioId === studioId) ?? docs.find((d) => d.type === type),
    ).filter((d): d is NonNullable<typeof d> => Boolean(d));
  }
}
