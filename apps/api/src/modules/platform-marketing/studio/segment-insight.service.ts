import { Injectable } from '@nestjs/common';
import type { Prisma } from '@platform/database';
import {
  MARKETING_MIN_CELL,
  countOrNull,
  safeAggregateLabel,
  suppressSmallCells,
  type SegmentInsightDTO,
  type SegmentInsightDimensionDTO,
} from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';

/** Label used for contacts without a value; clients show it translated. */
export const UNKNOWN_LABEL = 'unknown';

type Dimension = SegmentInsightDimensionDTO['key'];

/**
 * K-anonymous aggregates of the platform tenant's CRM (docs/PAZARLAMA_MODULU.md
 * 4.3, item 3). The only thing the segment suggestion model ever sees about
 * the contact database: per-dimension counts (lifecycle stage, country,
 * language, first source, acquisition channel). A cell below k is dropped and
 * folded into "other" only when the folded sum itself reaches k. No
 * contact row, name, phone, e-mail, tag or note is read.
 */
@Injectable()
export class SegmentInsightService {
  constructor(private readonly prisma: PrismaService) {}

  private baseWhere(studioId: string): Prisma.ContactWhereInput {
    return { studioId, isTest: false, mergedIntoId: null };
  }

  async compute(studioId: string): Promise<SegmentInsightDTO> {
    const where = this.baseWhere(studioId);
    const [total, lifecycle, country, locale, firstSource, sourceChannel] = await Promise.all([
      this.prisma.contact.count({ where }),
      this.prisma.contact.groupBy({ by: ['lifecycleStage'], where, _count: { _all: true } }),
      this.prisma.contact.groupBy({ by: ['countryCode'], where, _count: { _all: true } }),
      this.prisma.contact.groupBy({ by: ['locale'], where, _count: { _all: true } }),
      this.prisma.contact.groupBy({ by: ['firstSource'], where, _count: { _all: true } }),
      this.prisma.contact.groupBy({ by: ['sourceChannel'], where, _count: { _all: true } }),
    ]);

    const dimension = (key: Dimension, rows: Array<{ label: string | null; count: number }>): SegmentInsightDimensionDTO => {
      // Different raw values can map to the same safe label (e.g. all unsafe ones to "unknown"): merge before suppressing.
      const merged = new Map<string, number>();
      for (const row of rows) {
        const label = row.label === null ? UNKNOWN_LABEL : key === 'firstSource' || key === 'sourceChannel' ? safeAggregateLabel(row.label, UNKNOWN_LABEL) : row.label;
        merged.set(label, (merged.get(label) ?? 0) + row.count);
      }
      const { cells, otherCount } = suppressSmallCells([...merged].map(([label, count]) => ({ label, count })));
      return { key, cells, otherCount };
    };

    return {
      k: MARKETING_MIN_CELL,
      totalContacts: countOrNull(total),
      dimensions:
        total < MARKETING_MIN_CELL
          ? []
          : [
              dimension('lifecycleStage', lifecycle.map((r) => ({ label: r.lifecycleStage, count: r._count._all }))),
              dimension('countryCode', country.map((r) => ({ label: r.countryCode, count: r._count._all }))),
              dimension('locale', locale.map((r) => ({ label: r.locale, count: r._count._all }))),
              dimension('firstSource', firstSource.map((r) => ({ label: r.firstSource, count: r._count._all }))),
              dimension('sourceChannel', sourceChannel.map((r) => ({ label: r.sourceChannel, count: r._count._all }))),
            ],
    };
  }

  /** Number of real (non-test, non-merged) contacts matching a compiled segment condition. */
  async countMatching(studioId: string, compiled: Prisma.ContactWhereInput): Promise<number> {
    return this.prisma.contact.count({ where: { AND: [compiled, this.baseWhere(studioId)] } });
  }
}
