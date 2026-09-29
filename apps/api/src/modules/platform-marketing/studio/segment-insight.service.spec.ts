import { MARKETING_MIN_CELL } from '@platform/shared';
import type { PrismaService } from '../../prisma/prisma.service';
import { SegmentInsightService, UNKNOWN_LABEL } from './segment-insight.service';

type Row = Record<string, string | null | { _all: number }>;

function serviceWith(groups: Record<string, Array<{ value: string | null; count: number }>>, total: number): SegmentInsightService {
  const groupBy = jest.fn(async ({ by }: { by: string[] }) => {
    const key = by[0];
    return (groups[key] ?? []).map((g): Row => ({ [key]: g.value, _count: { _all: g.count } }));
  });
  const prisma = { contact: { count: jest.fn(async () => total), groupBy } } as unknown as PrismaService;
  return new SegmentInsightService(prisma);
}

const allCells = (insight: Awaited<ReturnType<SegmentInsightService['compute']>>) => insight.dimensions.flatMap((d) => d.cells);

describe('SegmentInsightService (k-anonymity)', () => {
  it('never emits a cell below k, and folds hidden cells into "other" only when they reach k', async () => {
    const service = serviceWith(
      {
        lifecycleStage: [
          { value: 'LEAD', count: 30 },
          { value: 'TRIAL', count: 4 },
          { value: 'MEMBER', count: 3 },
          { value: 'LOST', count: 1 },
        ],
        countryCode: [
          { value: 'TR', count: 20 },
          { value: 'DE', count: 2 },
          { value: 'AT', count: 1 },
        ],
        locale: [{ value: 'tr', count: 38 }],
        firstSource: [],
        sourceChannel: [],
      },
      38,
    );
    const insight = await service.compute('platform');
    expect(insight.k).toBe(MARKETING_MIN_CELL);
    expect(insight.totalContacts).toBe(38);
    for (const cell of allCells(insight)) expect(cell.count).toBeGreaterThanOrEqual(MARKETING_MIN_CELL);
    const lifecycle = insight.dimensions.find((d) => d.key === 'lifecycleStage');
    expect(lifecycle?.cells).toEqual([{ label: 'LEAD', count: 30 }]);
    // 4 + 3 + 1 = 8 hidden and 8 >= k: reported as one folded number.
    expect(lifecycle?.otherCount).toBe(8);
    // 2 + 1 = 3 hidden and 3 < k: not reported, so subtracting from the total reveals nothing.
    expect(insight.dimensions.find((d) => d.key === 'countryCode')?.otherCount).toBe(0);
  });

  it('reports nothing at all when the whole database has fewer than k contacts', async () => {
    const service = serviceWith({ lifecycleStage: [{ value: 'LEAD', count: 4 }] }, 4);
    const insight = await service.compute('platform');
    expect(insight.totalContacts).toBeNull();
    expect(insight.dimensions).toEqual([]);
  });

  it('merges unsafe free-text labels (e-mail or phone like sources) into "unknown" and never leaks them', async () => {
    const service = serviceWith(
      {
        lifecycleStage: [{ value: 'LEAD', count: 40 }],
        firstSource: [
          { value: 'newsletter', count: 12 },
          { value: 'jane.doe@example.com', count: 3 },
          { value: '+905321112233', count: 3 },
          { value: null, count: 22 },
        ],
      },
      40,
    );
    const insight = await service.compute('platform');
    const json = JSON.stringify(insight);
    expect(json).not.toContain('jane.doe');
    expect(json).not.toContain('905321112233');
    const source = insight.dimensions.find((d) => d.key === 'firstSource');
    expect(source?.cells).toEqual([
      { label: UNKNOWN_LABEL, count: 28 },
      { label: 'newsletter', count: 12 },
    ]);
    for (const cell of allCells(insight)) expect(cell.count).toBeGreaterThanOrEqual(MARKETING_MIN_CELL);
  });

  it('only counts and groups: it never selects a name, phone or e-mail column', async () => {
    const service = serviceWith({ lifecycleStage: [{ value: 'LEAD', count: 10 }] }, 10);
    await service.compute('platform');
    const prisma = (service as unknown as { prisma: { contact: { groupBy: jest.Mock } } }).prisma;
    const groupedBy = prisma.contact.groupBy.mock.calls.map(([args]) => (args as { by: string[] }).by[0]);
    expect(groupedBy.sort()).toEqual(['countryCode', 'firstSource', 'lifecycleStage', 'locale', 'sourceChannel']);
    for (const column of groupedBy) expect(['firstName', 'lastName', 'phone', 'email', 'notes']).not.toContain(column);
  });
});
