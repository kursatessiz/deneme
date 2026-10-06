import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@platform/database';
import type { Journey } from '@platform/database';
import {
  BASE_MESSAGES,
  BUNDLED_MESSAGES,
  DEFAULT_LEGACY_PARAMS,
  JOURNEY_ENROLLMENT_STATUSES,
  JourneyDefinitionSchema,
  WIN_BACK_SEGMENT_PLACEHOLDER,
  contactDisplayName,
  createTranslator,
  journeyTemplates,
  validateJourneyGraph,
  winBackSegmentRules,
} from '@platform/shared';
import type {
  CreateJourneyFromTemplateInput,
  CreateJourneyInput,
  JourneyDTO,
  JourneyDefinition,
  JourneyDetailDTO,
  JourneyEnrollmentDTO,
  JourneyEnrollmentStatus,
  JourneyEnrollmentsQuery,
  JourneyStatsDTO,
  JourneyTemplateDTO,
  MessageKey,
  SegmentGroup,
  UpdateJourneyInput,
} from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { TenantContext } from '../../auth/tenant-context';
import { SegmentEvaluatorService } from '../segments/segment-evaluator.service';
import { JourneyEngineService } from './journey-engine.service';
import { apiError } from '../../../common/api-error';

type Db = PrismaService | Prisma.TransactionClient;

export function toJourneyDto(j: Journey): JourneyDTO {
  return {
    id: j.id,
    name: j.name,
    description: j.description,
    status: j.status,
    definition: j.definition as unknown as JourneyDefinition,
    templateKey: j.templateKey,
    legacyRuleType: j.legacyRuleType,
    activatedAt: j.activatedAt?.toISOString() ?? null,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
  };
}

/** Every segment rule set inside a definition (trigger filter, goal, branch conditions). */
function conditionsOf(def: JourneyDefinition): SegmentGroup[] {
  const groups: SegmentGroup[] = [];
  if (def.trigger.kind === 'event' && def.trigger.filter) groups.push(def.trigger.filter);
  if (def.goal) groups.push(def.goal);
  for (const step of Object.values(def.steps)) if (step.type === 'branch') groups.push(step.condition);
  return groups;
}

/**
 * Journeys (section 3.7): CRUD, the template gallery, activation and
 * statistics. Every definition is validated with the shared Zod schema,
 * the graph checks (entry, links, no cycles, available step types) and the
 * tenant-aware checks here: segment rules against the tenant's custom
 * fields, referenced segments, templates and assignees belonging to this
 * studio. A definition can only change while the journey is not running.
 */
@Injectable()
export class JourneysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evaluator: SegmentEvaluatorService,
    private readonly engine: JourneyEngineService,
  ) {}

  templates(): JourneyTemplateDTO[] {
    return journeyTemplates();
  }

  async list(studioId: string): Promise<JourneyDTO[]> {
    const rows = await this.prisma.journey.findMany({ where: { studioId, status: { not: 'ARCHIVED' } }, orderBy: { createdAt: 'desc' } });
    return rows.map(toJourneyDto);
  }

  async get(studioId: string, id: string): Promise<Journey> {
    const row = await this.prisma.journey.findFirst({ where: { id, studioId } });
    if (!row) throw new NotFoundException(apiError('apiErrors.growth.journeyNotFound'));
    return row;
  }

  async detail(studioId: string, id: string): Promise<JourneyDetailDTO> {
    const journey = await this.get(studioId, id);
    return { ...toJourneyDto(journey), stats: await this.stats(journey) };
  }

  async validateDefinition(studioId: string, raw: unknown, db: Db = this.prisma): Promise<JourneyDefinition> {
    const parsed = JourneyDefinitionSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({ ...apiError('apiErrors.growth.invalidJourney'), errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    const def = parsed.data;
    const issues = validateJourneyGraph(def);
    if (issues.length) throw new BadRequestException({ ...apiError('apiErrors.growth.invalidJourney'), errors: issues.map((message) => ({ path: 'definition', message })) });
    for (const group of conditionsOf(def)) await this.evaluator.validate(studioId, group);

    if (def.trigger.kind === 'segment_entered') {
      const segment = await db.segment.findFirst({ where: { id: def.trigger.segmentId, studioId, archivedAt: null }, select: { id: true } });
      if (!segment) throw new BadRequestException(apiError('apiErrors.growth.triggerSegmentNotFoundBusiness'));
    }
    for (const [stepId, step] of Object.entries(def.steps)) {
      if (step.type === 'send' && step.templateId) {
        const tpl = await db.messageTemplate.findFirst({ where: { id: step.templateId, OR: [{ studioId }, { studioId: null }] }, select: { id: true } });
        if (!tpl) throw new BadRequestException(apiError('apiErrors.growth.stepTemplateNotFound', { step: stepId }));
      }
      if (step.type === 'create_task' && step.assigneeId) {
        const found =
          step.assignTo === 'USER'
            ? await db.membership.findFirst({ where: { id: step.assigneeId, studioId }, select: { id: true } })
            : await db.roleTemplate.findFirst({ where: { id: step.assigneeId, studioId }, select: { id: true } });
        if (!found) throw new BadRequestException(apiError('apiErrors.growth.stepAssigneeNotFound', { step: stepId }));
      }
    }
    return def;
  }

  async create(tenant: TenantContext, input: CreateJourneyInput): Promise<JourneyDTO> {
    const definition = await this.validateDefinition(tenant.studioId, input.definition);
    const row = await this.prisma.journey.create({
      data: {
        studioId: tenant.studioId,
        name: input.name,
        description: input.description ?? null,
        definition: definition as unknown as Prisma.InputJsonValue,
        createdByMembershipId: tenant.membershipId,
      },
    });
    return toJourneyDto(row);
  }

  /** A journey from the gallery, as a DRAFT. Win-back also gets its own audience segment. */
  async createFromTemplate(tenant: TenantContext, input: CreateJourneyFromTemplateInput): Promise<JourneyDTO> {
    const template = journeyTemplates().find((t) => t.key === input.templateKey);
    if (!template) throw new NotFoundException(apiError('apiErrors.common.templateNotFound'));
    const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: tenant.studioId }, select: { defaultLocale: true } });
    const t = createTranslator({ locale: studio.defaultLocale, messages: BUNDLED_MESSAGES[studio.defaultLocale] ?? BASE_MESSAGES, fallback: BASE_MESSAGES });
    const name = input.name ?? t(`journeys.template.${template.key}.name` as MessageKey);

    const row = await this.prisma.$transaction(async (tx) => {
      let definition = template.definition;
      if (template.legacyRuleType === 'WIN_BACK') {
        const params = DEFAULT_LEGACY_PARAMS.WIN_BACK;
        if (params.type !== 'WIN_BACK') throw new Error('unreachable');
        const segment = await tx.segment.create({
          data: {
            studioId: tenant.studioId,
            name: t('journeys.template.win_back.segmentName'),
            kind: 'DYNAMIC',
            rules: winBackSegmentRules(params) as unknown as Prisma.InputJsonValue,
            createdByMembershipId: tenant.membershipId,
          },
        });
        definition = JSON.parse(JSON.stringify(definition).split(WIN_BACK_SEGMENT_PLACEHOLDER).join(segment.id)) as JourneyDefinition;
      }
      return tx.journey.create({
        data: {
          studioId: tenant.studioId,
          name,
          definition: definition as unknown as Prisma.InputJsonValue,
          templateKey: template.key,
          legacyRuleType: template.legacyRuleType,
          createdByMembershipId: tenant.membershipId,
        },
      });
    });
    return toJourneyDto(row);
  }

  async update(studioId: string, id: string, input: UpdateJourneyInput): Promise<JourneyDTO> {
    const journey = await this.get(studioId, id);
    if (input.definition && journey.status === 'ACTIVE') throw new ConflictException(apiError('apiErrors.growth.stepsRunningJourneyCannotChangedStop'));
    if (journey.status === 'ARCHIVED') throw new ConflictException(apiError('apiErrors.growth.archivedJourneyCannotChanged'));
    const definition = input.definition ? await this.validateDefinition(studioId, input.definition) : undefined;
    const row = await this.prisma.journey.update({
      where: { id: journey.id },
      data: {
        name: input.name,
        description: input.description,
        ...(definition ? { definition: definition as unknown as Prisma.InputJsonValue } : {}),
      },
    });
    return toJourneyDto(row);
  }

  async activate(studioId: string, id: string, now = new Date()): Promise<JourneyDTO> {
    const journey = await this.get(studioId, id);
    if (journey.status === 'ARCHIVED') throw new ConflictException(apiError('apiErrors.growth.archivedJourneyCannotStarted'));
    await this.validateDefinition(studioId, journey.definition);
    const row = await this.prisma.journey.update({
      where: { id: journey.id },
      data: { status: 'ACTIVE', activatedAt: journey.activatedAt ?? now },
    });
    return toJourneyDto(row);
  }

  async pause(studioId: string, id: string): Promise<JourneyDTO> {
    const journey = await this.get(studioId, id);
    if (journey.status !== 'ACTIVE') throw new ConflictException(apiError('apiErrors.growth.onlyRunningJourneyCanStopped'));
    return toJourneyDto(await this.prisma.journey.update({ where: { id: journey.id }, data: { status: 'PAUSED' } }));
  }

  async archive(studioId: string, id: string, now = new Date()): Promise<JourneyDTO> {
    const journey = await this.get(studioId, id);
    const row = await this.prisma.journey.update({ where: { id: journey.id }, data: { status: 'ARCHIVED' } });
    await this.engine.cancelAll(journey.id, now);
    return toJourneyDto(row);
  }

  async remove(studioId: string, id: string): Promise<{ deleted: true }> {
    const journey = await this.get(studioId, id);
    if (journey.status !== 'DRAFT') throw new ConflictException(apiError('apiErrors.growth.onlyDraftJourneyCanDeleted'));
    const enrollments = await this.prisma.journeyEnrollment.count({ where: { journeyId: journey.id } });
    if (enrollments > 0) throw new ConflictException(apiError('apiErrors.growth.journeyContactsEnteredCannotDeletedArchive'));
    await this.prisma.journey.delete({ where: { id: journey.id } });
    return { deleted: true };
  }

  async enrollments(studioId: string, id: string, query: JourneyEnrollmentsQuery): Promise<{ items: JourneyEnrollmentDTO[]; total: number }> {
    const journey = await this.get(studioId, id);
    const where: Prisma.JourneyEnrollmentWhereInput = { studioId, journeyId: journey.id, ...(query.status ? { status: query.status } : {}) };
    const [total, rows] = await Promise.all([
      this.prisma.journeyEnrollment.count({ where }),
      this.prisma.journeyEnrollment.findMany({
        where,
        include: { contact: { select: { firstName: true, lastName: true } } },
        orderBy: { enteredAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    return {
      total,
      items: rows.map((e) => ({
        id: e.id,
        contactId: e.contactId,
        fullName: contactDisplayName(e.contact),
        status: e.status,
        currentStepId: e.currentStepId,
        nextRunAt: e.nextRunAt?.toISOString() ?? null,
        enteredAt: e.enteredAt.toISOString(),
        completedAt: e.completedAt?.toISOString() ?? null,
        exitReason: e.exitReason,
      })),
    };
  }

  async stats(journey: Journey, since?: Date): Promise<JourneyStatsDTO> {
    const [byStatus, bySteps] = await Promise.all([
      this.prisma.journeyEnrollment.groupBy({ by: ['status'], where: { journeyId: journey.id }, _count: { _all: true } }),
      this.prisma.journeyStepRun.groupBy({
        by: ['stepId', 'status'],
        where: { journeyId: journey.id, ...(since ? { createdAt: { gte: since } } : {}) },
        _count: { _all: true },
      }),
    ]);
    const enrollments = Object.fromEntries(JOURNEY_ENROLLMENT_STATUSES.map((s) => [s, 0])) as Record<JourneyEnrollmentStatus, number>;
    for (const row of byStatus) enrollments[row.status] = row._count._all;
    const steps: JourneyStatsDTO['steps'] = {};
    for (const row of bySteps) {
      const entry = (steps[row.stepId] ??= { done: 0, skipped: 0, failed: 0 });
      if (row.status === 'DONE') entry.done += row._count._all;
      else if (row.status === 'SKIPPED') entry.skipped += row._count._all;
      else entry.failed += row._count._all;
    }
    return { enrollments, steps };
  }
}
