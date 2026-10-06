import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@platform/database';
import type { PipelineStage } from '@platform/database';
import { DEFAULT_PIPELINE_STAGES } from '@platform/shared';
import type { CreatePipelineStageInput, PipelineStageDTO, UpdatePipelineStageInput } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { apiError } from '../../../common/api-error';

/**
 * Sales pipeline stages: tenant data. Every tenant has the system stages
 * of DEFAULT_PIPELINE_STAGES (created by the migration, the seed, tenant
 * creation, and lazily here for any studio that somehow lacks them).
 */
@Injectable()
export class PipelineService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureDefaults(studioId: string): Promise<void> {
    await this.prisma.pipelineStage.createMany({
      data: DEFAULT_PIPELINE_STAGES.map((s) => ({
        studioId,
        key: s.key,
        kind: s.kind,
        sortOrder: s.sortOrder,
        isSystem: true,
      })),
      skipDuplicates: true,
    });
  }

  async list(studioId: string): Promise<PipelineStageDTO[]> {
    let stages = await this.prisma.pipelineStage.findMany({ where: { studioId }, orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }] });
    if (stages.length === 0) {
      await this.ensureDefaults(studioId);
      stages = await this.prisma.pipelineStage.findMany({ where: { studioId }, orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }] });
    }
    return stages.map(toDto);
  }

  /** The stage with this key in the studio; creates the defaults first when missing. */
  async getByKey(studioId: string, key: string): Promise<PipelineStage> {
    let stage = await this.prisma.pipelineStage.findUnique({ where: { studioId_key: { studioId, key } } });
    if (!stage && DEFAULT_PIPELINE_STAGES.some((s) => s.key === key)) {
      await this.ensureDefaults(studioId);
      stage = await this.prisma.pipelineStage.findUnique({ where: { studioId_key: { studioId, key } } });
    }
    if (!stage) throw new BadRequestException(apiError('apiErrors.crm.pipelineStageKeyNotFound', { key: key }));
    return stage;
  }

  async create(studioId: string, dto: CreatePipelineStageInput): Promise<PipelineStageDTO> {
    try {
      const stage = await this.prisma.pipelineStage.create({
        data: { studioId, key: dto.key, name: dto.name, kind: dto.kind, sortOrder: dto.sortOrder ?? 100, isSystem: false },
      });
      return toDto(stage);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(apiError('apiErrors.crm.stageKeyAlreadyExists'));
      }
      throw err;
    }
  }

  async update(studioId: string, stageId: string, dto: UpdatePipelineStageInput): Promise<PipelineStageDTO> {
    const stage = await this.getOwn(studioId, stageId);
    if (dto.name === null && !stage.isSystem) {
      throw new BadRequestException(apiError('apiErrors.crm.customStagesMustName'));
    }
    const updated = await this.prisma.pipelineStage.update({
      where: { id: stage.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });
    return toDto(updated);
  }

  async remove(studioId: string, stageId: string): Promise<{ deleted: true }> {
    const stage = await this.getOwn(studioId, stageId);
    if (stage.isSystem) throw new BadRequestException(apiError('apiErrors.crm.systemStagesCannotDeleted'));
    const inUse = await this.prisma.contact.count({ where: { studioId, pipelineStageId: stage.id, mergedIntoId: null } });
    if (inUse > 0) throw new ConflictException(apiError('apiErrors.crm.contactsStageMoveThemAnotherStage'));
    await this.prisma.pipelineStage.delete({ where: { id: stage.id } });
    return { deleted: true };
  }

  private async getOwn(studioId: string, stageId: string): Promise<PipelineStage> {
    const stage = await this.prisma.pipelineStage.findFirst({ where: { id: stageId, studioId } });
    if (!stage) throw new NotFoundException(apiError('apiErrors.crm.stageNotFound'));
    return stage;
  }
}

function toDto(s: PipelineStage): PipelineStageDTO {
  return { id: s.id, key: s.key, name: s.name, kind: s.kind, sortOrder: s.sortOrder, isSystem: s.isSystem };
}
