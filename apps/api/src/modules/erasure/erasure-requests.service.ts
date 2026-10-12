import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ERASURE_AUDIT_ACTIONS,
  ERASURE_AUTO_PROCESS_DAYS,
  ERASURE_BATCH_SIZE,
  ERASURE_MAX_ATTEMPTS,
  ERASURE_OPEN_STATUSES,
  type ErasureHeartbeatResult,
  type ErasureRequestDTO,
  type ErasureRequestListQuery,
  type ErasureRequestSource,
  type ErasureRequestStatus,
  type SelfErasureStatusDTO,
} from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingService } from '../messaging/engine/messaging.service';
import { assertBranchAccess } from '../branches/branch-access';
import type { TenantContext } from '../auth/tenant-context';
import { apiError, hasApiErrorCode } from '../../common/api-error';
import { ErasureAnonymizerService } from './erasure-anonymizer.service';

const DAY_MS = 24 * 60 * 60 * 1000;

const REQUEST_INCLUDE = {
  membership: {
    select: {
      erasedAt: true,
      user: { select: { firstName: true, lastName: true } },
      memberProfile: { select: { id: true } },
    },
  },
} satisfies Prisma.DataErasureRequestInclude;
type RequestRow = Prisma.DataErasureRequestGetPayload<{ include: typeof REQUEST_INCLUDE }>;

export function toErasureRequestDTO(row: RequestRow): ErasureRequestDTO {
  const erased = Boolean(row.membership.erasedAt);
  return {
    id: row.id,
    membershipId: row.membershipId,
    memberProfileId: row.membership.memberProfile?.id ?? null,
    memberName: erased ? null : `${row.membership.user.firstName} ${row.membership.user.lastName}`.trim(),
    source: row.source as ErasureRequestSource,
    status: row.status as ErasureRequestStatus,
    requestedAt: row.requestedAt.toISOString(),
    dueAt: row.dueAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionNote: row.decisionNote,
    autoProcessed: row.autoProcessed,
    executedAt: row.executedAt?.toISOString() ?? null,
  };
}

/**
 * Lifecycle of KVKK/GDPR erasure requests (docs/KVKK_SILME.md): the member
 * asks, staff with `members.erase` approve or reject (or start erasure
 * directly from the member card), the heartbeat executes approved requests
 * and requests nobody handled within ERASURE_AUTO_PROCESS_DAYS. Every step is
 * audited; the member is notified of the decision through the messaging engine.
 */
@Injectable()
export class ErasureRequestsService {
  private readonly logger = new Logger(ErasureRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly anonymizer: ErasureAnonymizerService,
    private readonly messaging: MessagingService,
  ) {}

  // -- Member -------------------------------------------------------------------------------------

  /** The member asks for erasure of their data in this studio. */
  async requestOwn(tenant: TenantContext, actorUserId: string): Promise<ErasureRequestDTO> {
    if (!tenant.membershipId || !tenant.memberProfileId) throw new ForbiddenException(apiError('apiErrors.members.noMemberProfileBusiness'));
    await this.anonymizer.loadEligibleMembership(tenant.studioId, tenant.membershipId);
    const now = new Date();
    const created = await this.createOpenRequest({
      studioId: tenant.studioId,
      membershipId: tenant.membershipId,
      source: 'MEMBER',
      status: 'PENDING',
      requestedByUserId: actorUserId,
      requestedAt: now,
    });
    await this.audit(tenant.studioId, actorUserId, ERASURE_AUDIT_ACTIONS.requested, created.id, { source: 'MEMBER' });
    return toErasureRequestDTO(created);
  }

  /** The caller's latest request in this studio, whatever its status. */
  async getOwn(tenant: TenantContext): Promise<SelfErasureStatusDTO> {
    if (!tenant.membershipId || !tenant.memberProfileId) throw new ForbiddenException(apiError('apiErrors.members.noMemberProfileBusiness'));
    const row = await this.prisma.dataErasureRequest.findFirst({
      where: { studioId: tenant.studioId, membershipId: tenant.membershipId },
      orderBy: { requestedAt: 'desc' },
      include: REQUEST_INCLUDE,
    });
    return { request: row ? toErasureRequestDTO(row) : null };
  }

  // -- Staff --------------------------------------------------------------------------------------

  /** Requests of the studio; without a status filter, the open ones (PENDING and APPROVED). */
  async list(tenant: TenantContext, query: ErasureRequestListQuery): Promise<ErasureRequestDTO[]> {
    const rows = await this.prisma.dataErasureRequest.findMany({
      where: {
        studioId: tenant.studioId,
        status: query.status ? query.status : { in: [...ERASURE_OPEN_STATUSES] },
        // Branch-restricted staff see members of their branches and studio-wide members only.
        ...(tenant.branchIds !== null
          ? { membership: { memberProfile: { OR: [{ homeBranchId: { in: [...tenant.branchIds] } }, { homeBranchId: null }] } } }
          : {}),
      },
      orderBy: { requestedAt: 'asc' },
      include: REQUEST_INCLUDE,
      take: 200,
    });
    return rows.map(toErasureRequestDTO);
  }

  /** Latest request of one member (member card). */
  async getForMember(tenant: TenantContext, memberProfileId: string): Promise<SelfErasureStatusDTO> {
    const profile = await this.prisma.memberProfile.findFirst({
      where: { id: memberProfileId, studioId: tenant.studioId },
      select: { membershipId: true, homeBranchId: true },
    });
    if (!profile) throw new NotFoundException(apiError('apiErrors.common.memberNotFound'));
    assertBranchAccess(tenant, profile.homeBranchId);
    const row = await this.prisma.dataErasureRequest.findFirst({
      where: { studioId: tenant.studioId, membershipId: profile.membershipId },
      orderBy: { requestedAt: 'desc' },
      include: REQUEST_INCLUDE,
    });
    return { request: row ? toErasureRequestDTO(row) : null };
  }

  async approve(tenant: TenantContext, actorUserId: string, requestId: string, note?: string): Promise<ErasureRequestDTO> {
    const row = await this.decide(tenant, actorUserId, requestId, 'APPROVED', note);
    await this.audit(tenant.studioId, actorUserId, ERASURE_AUDIT_ACTIONS.approved, row.id, { source: row.source });
    await this.notifyMember(row, 'ERASURE_REQUEST_APPROVED', 'approved');
    return toErasureRequestDTO(row);
  }

  async reject(tenant: TenantContext, actorUserId: string, requestId: string, note?: string): Promise<ErasureRequestDTO> {
    const row = await this.decide(tenant, actorUserId, requestId, 'REJECTED', note);
    await this.audit(tenant.studioId, actorUserId, ERASURE_AUDIT_ACTIONS.rejected, row.id, { source: row.source });
    await this.notifyMember(row, 'ERASURE_REQUEST_REJECTED', 'rejected');
    return toErasureRequestDTO(row);
  }

  /**
   * Staff start erasure directly from the member card: an already approved
   * request is created (or an open one is taken over) and executed at once.
   * When the execution fails the request stays APPROVED and the heartbeat
   * retries it.
   */
  async startDirect(tenant: TenantContext, actorUserId: string, memberProfileId: string, note?: string): Promise<ErasureRequestDTO> {
    const profile = await this.prisma.memberProfile.findFirst({
      where: { id: memberProfileId, studioId: tenant.studioId },
      select: { membershipId: true, homeBranchId: true },
    });
    if (!profile) throw new NotFoundException(apiError('apiErrors.common.memberNotFound'));
    assertBranchAccess(tenant, profile.homeBranchId);
    await this.anonymizer.loadEligibleMembership(tenant.studioId, profile.membershipId);

    const now = new Date();
    const open = await this.prisma.dataErasureRequest.findFirst({
      where: { studioId: tenant.studioId, membershipId: profile.membershipId, status: { in: [...ERASURE_OPEN_STATUSES] } },
    });
    let requestId: string;
    if (open) {
      requestId = open.id;
      await this.prisma.dataErasureRequest.update({
        where: { id: open.id },
        data: { status: 'APPROVED', decidedAt: open.decidedAt ?? now, decidedByUserId: open.decidedByUserId ?? actorUserId, decisionNote: note ?? open.decisionNote },
      });
    } else {
      const created = await this.createOpenRequest({
        studioId: tenant.studioId,
        membershipId: profile.membershipId,
        source: 'STUDIO',
        status: 'APPROVED',
        requestedByUserId: actorUserId,
        requestedAt: now,
        decidedAt: now,
        decidedByUserId: actorUserId,
        decisionNote: note ?? null,
      });
      requestId = created.id;
      await this.audit(tenant.studioId, actorUserId, ERASURE_AUDIT_ACTIONS.requested, created.id, { source: 'STUDIO' });
    }
    await this.audit(tenant.studioId, actorUserId, ERASURE_AUDIT_ACTIONS.approved, requestId, { source: open?.source ?? 'STUDIO', direct: true });

    try {
      await this.execute(requestId, { autoProcessed: false });
    } catch (err) {
      this.logger.warn(`Direct erasure ${requestId} failed and stays queued: ${err instanceof Error ? err.message : String(err)}`);
    }
    const row = await this.prisma.dataErasureRequest.findUniqueOrThrow({ where: { id: requestId }, include: REQUEST_INCLUDE });
    return toErasureRequestDTO(row);
  }

  // -- Execution (heartbeat and direct start) ------------------------------------------------------

  /**
   * Heartbeat step: executes approved requests (retrying failed ones up to
   * ERASURE_MAX_ATTEMPTS) and PENDING requests past their deadline.
   */
  async processDue(now = new Date()): Promise<ErasureHeartbeatResult> {
    const result: ErasureHeartbeatResult = { executed: 0, autoProcessed: 0, failed: 0 };

    const approved = await this.prisma.dataErasureRequest.findMany({
      where: { status: 'APPROVED', attempts: { lt: ERASURE_MAX_ATTEMPTS } },
      orderBy: { requestedAt: 'asc' },
      take: ERASURE_BATCH_SIZE,
      select: { id: true },
    });
    for (const request of approved) {
      if (await this.tryExecute(request.id, false, now)) result.executed += 1;
      else result.failed += 1;
    }

    const overdue = await this.prisma.dataErasureRequest.findMany({
      where: { status: 'PENDING', dueAt: { lte: now } },
      orderBy: { dueAt: 'asc' },
      take: ERASURE_BATCH_SIZE,
      select: { id: true, studioId: true, source: true },
    });
    for (const request of overdue) {
      await this.audit(request.studioId, null, ERASURE_AUDIT_ACTIONS.approved, request.id, { source: request.source, auto: true });
      if (await this.tryExecute(request.id, true, now)) {
        result.executed += 1;
        result.autoProcessed += 1;
      } else {
        result.failed += 1;
      }
    }
    return result;
  }

  private async tryExecute(requestId: string, autoProcessed: boolean, now: Date): Promise<boolean> {
    try {
      await this.execute(requestId, { autoProcessed, now });
      return true;
    } catch (err) {
      this.logger.error(`Erasure request ${requestId} failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /** Runs the anonymizer for one request and records the outcome. Idempotent. */
  async execute(requestId: string, options: { autoProcessed: boolean; now?: Date }): Promise<void> {
    const now = options.now ?? new Date();
    const request = await this.prisma.dataErasureRequest.findUnique({ where: { id: requestId } });
    if (!request || request.status === 'COMPLETED' || request.status === 'REJECTED') return;

    let summary: Record<string, number> = {};
    try {
      summary = await this.anonymizer.anonymizeMembership(request.studioId, request.membershipId, { requestId, now });
    } catch (err) {
      // A membership erased by an earlier, interrupted run: only the request record is left to close.
      if (!hasApiErrorCode(err, 'apiErrors.erasure.alreadyErased')) {
        await this.prisma.dataErasureRequest.update({
          where: { id: requestId },
          data: { attempts: { increment: 1 }, lastError: (err instanceof Error ? err.message : String(err)).slice(0, 300) },
        });
        throw err;
      }
    }
    await this.prisma.dataErasureRequest.update({
      where: { id: requestId },
      data: {
        status: 'COMPLETED',
        executedAt: now,
        summary: summary as Prisma.InputJsonValue,
        lastError: null,
        ...(options.autoProcessed ? { autoProcessed: true, decidedAt: request.decidedAt ?? now } : {}),
      },
    });
  }

  // -- Helpers ---------------------------------------------------------------------------------------

  private async decide(
    tenant: TenantContext,
    actorUserId: string,
    requestId: string,
    status: 'APPROVED' | 'REJECTED',
    note?: string,
  ): Promise<RequestRow> {
    const request = await this.prisma.dataErasureRequest.findFirst({
      where: { id: requestId, studioId: tenant.studioId },
      include: { membership: { select: { memberProfile: { select: { homeBranchId: true } } } } },
    });
    if (!request) throw new NotFoundException(apiError('apiErrors.erasure.requestNotFound'));
    assertBranchAccess(tenant, request.membership.memberProfile?.homeBranchId);
    if (request.status !== 'PENDING') throw new ConflictException(apiError('apiErrors.erasure.notDecidable'));
    if (status === 'APPROVED') await this.anonymizer.loadEligibleMembership(tenant.studioId, request.membershipId);

    // Conditional transition: two staff members cannot decide the same request twice.
    const changed = await this.prisma.dataErasureRequest.updateMany({
      where: { id: requestId, studioId: tenant.studioId, status: 'PENDING' },
      data: { status, decidedAt: new Date(), decidedByUserId: actorUserId, decisionNote: note ?? null },
    });
    if (changed.count === 0) throw new ConflictException(apiError('apiErrors.erasure.notDecidable'));
    return this.prisma.dataErasureRequest.findUniqueOrThrow({ where: { id: requestId }, include: REQUEST_INCLUDE });
  }

  private async createOpenRequest(data: {
    studioId: string;
    membershipId: string;
    source: ErasureRequestSource;
    status: ErasureRequestStatus;
    requestedByUserId: string;
    requestedAt: Date;
    decidedAt?: Date;
    decidedByUserId?: string;
    decisionNote?: string | null;
  }): Promise<RequestRow> {
    const open = await this.prisma.dataErasureRequest.findFirst({
      where: { membershipId: data.membershipId, status: { in: [...ERASURE_OPEN_STATUSES] } },
      select: { id: true },
    });
    if (open) throw new ConflictException(apiError('apiErrors.erasure.alreadyOpen'));
    try {
      return await this.prisma.dataErasureRequest.create({
        data: { ...data, dueAt: new Date(data.requestedAt.getTime() + ERASURE_AUTO_PROCESS_DAYS * DAY_MS) },
        include: REQUEST_INCLUDE,
      });
    } catch (err) {
      // The partial unique index closed a race between two concurrent requests.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new ConflictException(apiError('apiErrors.erasure.alreadyOpen'));
      throw err;
    }
  }

  /** Best effort: a missing channel or provider outage never blocks the decision. */
  private async notifyMember(row: RequestRow, templateKey: string, decision: string): Promise<void> {
    try {
      await this.messaging.send({
        studioId: row.studioId,
        recipient: { membershipId: row.membershipId },
        purpose: 'TRANSACTIONAL',
        templateKey,
        variables: {},
        idempotencyKey: `erasure:${row.id}:${decision}`,
      });
    } catch (err) {
      this.logger.warn(`Erasure decision notification failed for ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async audit(studioId: string, userId: string | null, action: string, requestId: string, metadata: Record<string, unknown>): Promise<void> {
    await this.prisma.auditLog.create({
      data: { studioId, userId, action, entityType: 'DataErasureRequest', entityId: requestId, metadata: metadata as Prisma.InputJsonValue },
    });
  }
}
