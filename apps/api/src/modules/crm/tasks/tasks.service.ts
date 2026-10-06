import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ContactTask } from '@platform/database';
import type { ContactTaskListQuery, CreateContactTaskInput, UpdateContactTaskInput } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { TenantContext } from '../../auth/tenant-context';
import { ContactsService } from '../contacts/contacts.service';
import { apiError } from '../../../common/api-error';

/** Follow-up tasks on contacts, assigned to staff memberships. */
@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
  ) {}

  async list(tenant: TenantContext, query: ContactTaskListQuery) {
    const tasks = await this.prisma.contactTask.findMany({
      where: {
        studioId: tenant.studioId,
        contact: { mergedIntoId: null },
        ...(query.status ? { status: query.status } : {}),
        ...(query.assigneeMembershipId ? { assigneeMembershipId: query.assigneeMembershipId } : {}),
        ...(query.overdue ? { status: 'OPEN', dueAt: { lt: new Date() } } : {}),
      },
      include: { contact: { select: { id: true, firstName: true, lastName: true, branchId: true } } },
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
      take: 500,
    });
    return tasks
      .filter((t) => tenant.branchIds === null || !t.contact.branchId || tenant.branchIds.has(t.contact.branchId))
      .map((t) => ({ ...toDto(t), contact: { id: t.contact.id, firstName: t.contact.firstName, lastName: t.contact.lastName } }));
  }

  async create(tenant: TenantContext, contactId: string, dto: CreateContactTaskInput) {
    const contact = await this.contacts.getOwn(tenant, contactId);
    if (dto.assigneeMembershipId) await this.contacts.assertStaffMembership(tenant.studioId, dto.assigneeMembershipId);
    const task = await this.prisma.contactTask.create({
      data: {
        studioId: tenant.studioId,
        contactId: contact.id,
        title: dto.title,
        notes: dto.notes ?? null,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        assigneeMembershipId: dto.assigneeMembershipId ?? null,
        createdByMembershipId: tenant.membershipId,
      },
    });
    return toDto(task);
  }

  async update(tenant: TenantContext, taskId: string, dto: UpdateContactTaskInput) {
    const task = await this.prisma.contactTask.findFirst({ where: { id: taskId, studioId: tenant.studioId } });
    if (!task) throw new NotFoundException(apiError('apiErrors.crm.taskNotFound'));
    await this.contacts.getOwn(tenant, task.contactId);
    if (dto.assigneeMembershipId) await this.contacts.assertStaffMembership(tenant.studioId, dto.assigneeMembershipId);
    if (dto.title !== undefined && !dto.title) throw new BadRequestException(apiError('apiErrors.crm.enterTitle'));
    const updated = await this.prisma.contactTask.update({
      where: { id: task.id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(dto.dueAt !== undefined ? { dueAt: dto.dueAt ? new Date(dto.dueAt) : null } : {}),
        ...(dto.assigneeMembershipId !== undefined ? { assigneeMembershipId: dto.assigneeMembershipId } : {}),
        ...(dto.status !== undefined
          ? { status: dto.status, completedAt: dto.status === 'DONE' ? task.completedAt ?? new Date() : null }
          : {}),
      },
    });
    return toDto(updated);
  }
}

function toDto(t: ContactTask) {
  return {
    id: t.id,
    contactId: t.contactId,
    title: t.title,
    notes: t.notes,
    dueAt: t.dueAt?.toISOString() ?? null,
    status: t.status,
    assigneeMembershipId: t.assigneeMembershipId,
    completedAt: t.completedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
  };
}
