import { BadRequestException } from '@nestjs/common';
import { DEFAULT_PIPELINE_STAGES, LeadStage } from '@platform/shared';
import { PipelineService } from './pipeline.service';
import type { PrismaService } from '../../prisma/prisma.service';

describe('PipelineService', () => {
  const prisma = {
    pipelineStage: { createMany: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), delete: jest.fn() },
    contact: { count: jest.fn() },
  };
  const service = new PipelineService(prisma as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  it('default stages keep the legacy lead stage keys and exactly one WON and one LOST stage', () => {
    expect(DEFAULT_PIPELINE_STAGES.map((s) => s.key)).toEqual(Object.values(LeadStage));
    expect(DEFAULT_PIPELINE_STAGES.filter((s) => s.kind === 'WON').map((s) => s.key)).toEqual(['WON']);
    expect(DEFAULT_PIPELINE_STAGES.filter((s) => s.kind === 'LOST').map((s) => s.key)).toEqual(['LOST']);
  });

  it('ensureDefaults inserts every default stage as a system stage, idempotently', async () => {
    await service.ensureDefaults('studio-1');
    const call = prisma.pipelineStage.createMany.mock.calls[0][0];
    expect(call.skipDuplicates).toBe(true);
    expect(call.data).toHaveLength(DEFAULT_PIPELINE_STAGES.length);
    expect(call.data.every((d: { isSystem: boolean; studioId: string }) => d.isSystem && d.studioId === 'studio-1')).toBe(true);
  });

  it('a studio without stages gets the defaults on first read', async () => {
    prisma.pipelineStage.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { id: '1', key: 'NEW', name: null, kind: 'OPEN', sortOrder: 0, isSystem: true },
    ]);
    const stages = await service.list('studio-2');
    expect(prisma.pipelineStage.createMany).toHaveBeenCalled();
    expect(stages[0].key).toBe('NEW');
  });

  it('getByKey creates missing defaults but rejects unknown custom keys', async () => {
    prisma.pipelineStage.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'x', key: 'WON' });
    await expect(service.getByKey('studio-3', 'WON')).resolves.toEqual({ id: 'x', key: 'WON' });
    prisma.pipelineStage.findUnique.mockResolvedValueOnce(null);
    await expect(service.getByKey('studio-3', 'NOPE')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('system stages cannot be deleted', async () => {
    prisma.pipelineStage.findFirst.mockResolvedValueOnce({ id: 's', isSystem: true });
    await expect(service.remove('studio-1', 's')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.pipelineStage.delete).not.toHaveBeenCalled();
  });
});
