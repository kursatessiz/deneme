import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  Optional,
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
import { CrmHooksService } from '../crm/hooks/crm-hooks.service';
import { PLATFORM_ACCESS_ERROR_CODES, isPlatformSystemRoleKey, isWriteRestricted } from '@platform/shared';
import { PlatformAccessService } from '../platform-access/platform-access.service';
import { billingRestrictedError } from '../auth/guards/billing-write.guard';
import { assertCanGrant, assertNotLocked } from '../role-templates/role-templates.service';
import { assertUnrestricted } from '../branches/branch-access';
import { apiError, codedError } from '../../common/api-error';
import { pickBundledLocale, requestedLocale, requestT, serverT } from '../../common/server-i18n';

export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;
/** Documents a person must accept to join a studio (latest published version). */
export const REQUIRED_DOCUMENTS: DocumentType[] = [DocumentType.KVKK_NOTICE, DocumentType.MEMBERSHIP_CONTRACT];
/** A platform account (M1) is staff of the platform, not a customer: only the privacy notice applies. */
export const PLATFORM_REQUIRED_DOCUMENTS: DocumentType[] = [DocumentType.KVKK_NOTICE];
const INVALID_INVITE = apiError('apiErrors.invites.invitationNotFoundExpiredAlreadyUsed');

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
    private readonly platformAccess: PlatformAccessService,
    @Optional() private readonly crm?: CrmHooksService,
  ) {}

  async create(tenant: TenantContext, creator: AuthUser, dto: CreateInviteInput) {
    if (dto.roleKey === 'owner') {
      throw new ForbiddenException(apiError('apiErrors.invites.businessOwnerRoleCannotGrantedInvitation'));
    }
    const required = dto.roleKey === 'member' ? 'members.manage' : 'staff.manage';
    if (!tenant.permissions.has(required)) {
      throw new ForbiddenException(apiError('apiErrors.invites.notPermissionCreateInvitationRole'));
    }
    // A branch-restricted actor must not mint a staff account: a new staff
    // membership has no branch rows, which means access to every branch.
    if (dto.roleKey !== 'member') assertUnrestricted(tenant);
    // Restricted mode (G5c-1): staff invites stay available (staff.manage is
    // on the allow-list), new members do not.
    if (dto.roleKey === 'member' && !tenant.isSuperAdmin && isWriteRestricted(tenant.billingStatus)) {
      throw billingRestrictedError();
    }
    // Platform accounts join only through the super admin's platform invite
    // (docs/PAZARLAMA_MODULU.md 2.6), never through a tenant invite.
    const studio = await this.prisma.studio.findUnique({ where: { id: tenant.studioId }, select: { isPlatform: true } });
    if (studio?.isPlatform || isPlatformSystemRoleKey(dto.roleKey)) {
      throw new ForbiddenException(codedError(PLATFORM_ACCESS_ERROR_CODES.platformTenantInvite, { statusCode: 403 }));
    }
    await this.planLimits.assertWithinLimit(tenant.studioId, dto.roleKey === 'member' ? 'maxActiveMembers' : 'maxStaff');

    const role = await this.prisma.roleTemplate.findUnique({
      where: { studioId_key: { studioId: tenant.studioId, key: dto.roleKey } },
    });
    if (!role || role.isOwner) throw new BadRequestException(apiError('apiErrors.common.roleNotFound'));
    assertNotLocked(role);
    // Same boundary as role assignment: a non-owner cannot invite into a
    // role holding permissions the inviter does not hold.
    const roleKeys = await this.prisma.roleTemplatePermission.findMany({ where: { roleTemplateId: role.id }, select: { permissionKey: true } });
    assertCanGrant(tenant, roleKeys.map((k) => k.permissionKey));

    const existing = await this.prisma.membership.findFirst({
      where: { studioId: tenant.studioId, status: 'ACTIVE', user: { phone: dto.phone } },
      select: { id: true },
    });
    if (existing) throw new ConflictException(apiError('apiErrors.invites.phoneNumberAlreadyActiveBusiness'));

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

  /**
   * Super-admin path (M1): an invite into the platform tenant that, once
   * accepted, activates the invitee's PlatformMembership. The caller has
   * already created that membership as INVITED.
   */
  async createPlatformInvite(opts: {
    platformStudioId: string;
    creatorUserId: string;
    systemRoleTemplateId: string;
    platformRoleTemplateId: string;
    phone: string;
    fullName: string;
    channel: InviteChannel;
  }) {
    return this.buildInvite(
      opts.platformStudioId,
      opts.creatorUserId,
      opts.systemRoleTemplateId,
      opts.phone,
      opts.fullName,
      opts.channel,
      opts.platformRoleTemplateId,
    );
  }

  private async buildInvite(
    studioId: string,
    creatorUserId: string,
    roleTemplateId: string,
    phone: string,
    fullName: string,
    channel: InviteChannel,
    platformRoleTemplateId: string | null = null,
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
          platformRoleTemplateId,
        },
        include: { studio: { select: { name: true, defaultLocale: true } } },
      });
    });

    const inviteUrl = `${this.config.getOrThrow<string>('PUBLIC_APP_URL').replace(/\/$/, '')}/j/${token}`;

    if (channel !== InviteChannel.SHOWN) {
      // INVITE_LINK template in the studio's language; a WhatsApp invite falls back to SMS.
      await this.notifications.sendTemplateToPhone({
        studioId,
        phone,
        templateKey: 'INVITE_LINK',
        variables: { studioName: invite.studio.name, inviteUrl },
        channels: channel === InviteChannel.WHATSAPP ? ['WHATSAPP', 'SMS'] : ['SMS'],
        type: 'INVITE_LINK',
        locale: invite.studio.defaultLocale,
        sensitive: true,
      });
    }

    // The token is returned once, for the QR code; only its hash is stored.
    return { id: invite.id, inviteUrl, token, expiresAt, channel: invite.channel };
  }

  async preview(token: string) {
    const invite = await this.findUsable(token);
    const documents = await this.requiredDocuments(invite.studioId, Boolean(invite.platformRoleTemplateId));
    return {
      studio: { name: invite.studio.name, logoUrl: invite.studio.logoUrl },
      fullName: invite.fullName,
      phoneMasked: maskPhone(invite.phone),
      roleName: invite.platformRoleTemplate?.name ?? invite.roleTemplate.name,
      isPlatformInvite: Boolean(invite.platformRoleTemplateId),
      expiresAt: invite.expiresAt,
      documents: documents.map((d) => ({ id: d.id, type: d.type, title: d.title, version: d.version, body: d.body })),
    };
  }

  async requestOtp(token: string, ip: string | null) {
    const invite = await this.findUsable(token);
    // The invitee has no account yet: the language of their request, else the business default.
    const sms = serverT(pickBundledLocale([requestedLocale(), invite.studio.defaultLocale]));
    await this.otp.issue({
      phone: invite.phone,
      purpose: OtpPurpose.INVITE,
      ip,
      deliver: true,
      studioId: invite.studioId,
      message: (code) => sms('apiTexts.otp.inviteSms', { studio: invite.studio.name, code }),
    });
    return { message: requestT()('apiTexts.otp.inviteSent'), messageKey: 'apiTexts.otp.inviteSent' as const, phoneMasked: maskPhone(invite.phone) };
  }

  async accept(token: string, dto: AcceptInviteInput, ip: string | null, visitorId: string | null = null) {
    const invite = await this.findUsable(token);
    const isPlatformInvite = Boolean(invite.platformRoleTemplateId);

    const documents = await this.requiredDocuments(invite.studioId, isPlatformInvite);
    const accepted = new Set(dto.acceptedDocumentVersionIds);
    if (documents.some((d) => !accepted.has(d.id))) {
      throw new BadRequestException(apiError('apiErrors.invites.mustAcceptContractPrivacyNoticeContinue'));
    }

    if (!(await this.otp.verify(invite.phone, OtpPurpose.INVITE, dto.code))) {
      throw new UnauthorizedException(apiError('apiErrors.invites.codeInvalidExpired'));
    }

    const existingUser = await this.prisma.user.findUnique({ where: { phone: invite.phone } });
    if (!existingUser?.pinHash && !dto.pin) {
      throw new BadRequestException(apiError('apiErrors.invites.setPinSignApp'));
    }
    const pinHash = dto.pin ? await bcrypt.hash(dto.pin, 10) : undefined;
    const [firstName, ...rest] = invite.fullName.trim().split(/\s+/);
    const lastName = rest.join(' ') || '-';
    const now = new Date();

    const { userId, membershipId } = await this.prisma.$transaction(async (tx) => {
      // Single use: exactly one request can claim the invite.
      const claimed = await tx.inviteToken.updateMany({
        where: { id: invite.id, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) throw new GoneException(INVALID_INVITE);

      const user = await tx.user.upsert({
        where: { phone: invite.phone },
        create: { phone: invite.phone, firstName, lastName, pinHash, phoneVerifiedAt: now },
        update: { phoneVerifiedAt: now, ...(pinHash ? { pinHash, failedPinAttempts: 0, pinLockedUntil: null, refreshTokenHash: null } : {}) },
      });

      if (isPlatformInvite) {
        const membershipId = await this.acceptPlatformInvite(tx, invite, user.id);
        await tx.consent.createMany({
          data: documents.map((d) => ({ membershipId, documentVersionId: d.id, acceptedAt: now, device: dto.device ?? null, ip })),
          skipDuplicates: true,
        });
        return { userId: user.id, membershipId };
      }

      const current = await tx.membership.findUnique({
        where: { userId_studioId: { userId: user.id, studioId: invite.studioId } },
      });
      if (current?.status === 'ACTIVE') throw new ConflictException(apiError('apiErrors.invites.alreadyActiveMembershipBusiness'));

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
      return { userId: user.id, membershipId: membership.id };
    });

    // CRM: a member who finished onboarding becomes (or is linked to) a contact.
    if (!isPlatformInvite && invite.roleTemplate.key === 'member') {
      await this.crm?.onMemberJoined(invite.studioId, membershipId, { visitorId });
    }

    const tokens = await this.auth.issueTokens(userId);
    return { ...tokens, user: await this.auth.sessionUser(userId) };
  }

  private async findUsable(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new NotFoundException(INVALID_INVITE);
    const invite = await this.prisma.inviteToken.findUnique({
      where: { tokenHash: hashInviteToken(token) },
      include: {
        studio: { select: { name: true, logoUrl: true, isActive: true, defaultLocale: true } },
        roleTemplate: { select: { key: true, name: true } },
        platformRoleTemplate: { select: { name: true } },
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

  /**
   * Platform invite acceptance (M1): the invite's platform role becomes the
   * member's role and PlatformAccessService activates it, writing the
   * platform tenant membership in this same transaction.
   */
  private async acceptPlatformInvite(
    tx: Prisma.TransactionClient,
    invite: { id: string; studioId: string; createdByUserId: string; platformRoleTemplateId: string | null },
    userId: string,
  ): Promise<string> {
    const platformRoleTemplateId = invite.platformRoleTemplateId as string;
    const pm = await tx.platformMembership.findUnique({ where: { userId } });
    if (pm?.status === 'ACTIVE') throw new ConflictException(apiError('apiErrors.invites.platformMembershipAlreadyActive'));
    if (pm) {
      await tx.platformMembership.update({ where: { id: pm.id }, data: { roleTemplateId: platformRoleTemplateId } });
    } else {
      await tx.platformMembership.create({
        data: { userId, roleTemplateId: platformRoleTemplateId, status: 'INVITED', invitedByUserId: invite.createdByUserId },
      });
    }
    const { membershipId } = await this.platformAccess.activateInTx(tx, userId);
    await tx.auditLog.create({
      data: {
        studioId: null,
        userId,
        action: 'platform_user.activated',
        entityType: 'platform_membership',
        entityId: userId,
        metadata: { inviteId: invite.id, platformRoleTemplateId, invitedByUserId: invite.createdByUserId, via: 'invite' } as Prisma.InputJsonValue,
      },
    });
    return membershipId;
  }

  /** Latest published version per required type; studio text wins over the platform text. */
  private async requiredDocuments(studioId: string, platformInvite = false) {
    const required = platformInvite ? PLATFORM_REQUIRED_DOCUMENTS : REQUIRED_DOCUMENTS;
    const docs = await this.prisma.documentVersion.findMany({
      where: {
        type: { in: required },
        publishedAt: { not: null, lte: new Date() },
        OR: [{ studioId }, { studioId: null }],
      },
      orderBy: [{ version: 'desc' }],
    });
    return required.map(
      (type) => docs.find((d) => d.type === type && d.studioId === studioId) ?? docs.find((d) => d.type === type),
    ).filter((d): d is NonNullable<typeof d> => Boolean(d));
  }
}
