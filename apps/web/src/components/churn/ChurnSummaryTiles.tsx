'use client';

import type { ChurnSummaryDTO } from '@platform/shared';

const LEVEL_LABEL: Record<string, string> = { HIGH: 'Yüksek risk', MEDIUM: 'Orta risk', LOW: 'Düşük risk' };

export function ChurnSummaryTiles({ summary }: { summary: ChurnSummaryDTO }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {summary.counts.map((c) => {
        const delta = c.count - c.previousCount;
        return (
          <div key={c.level} className="p-4" style={{ borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              {LEVEL_LABEL[c.level] ?? c.level}
            </div>
            <div className="text-xl font-bold mt-1" style={{ color: 'var(--color-text-primary)' }}>
              {c.count}
            </div>
            {c.previousCount !== undefined && (
              <div className="text-xs mt-0.5" style={{ color: delta > 0 ? '#b42318' : delta < 0 ? '#15803d' : 'var(--color-text-muted)' }}>
                Geçen haftaya göre {delta > 0 ? '+' : ''}
                {delta}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

