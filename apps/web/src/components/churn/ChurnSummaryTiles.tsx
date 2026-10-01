'use client';

import type { ChurnSummaryDTO } from '@platform/shared';
import { useT } from '@/components/i18n/I18nProvider';
import { StatTile } from '@/components/ui/StatTile';

export function ChurnSummaryTiles({ summary }: { summary: ChurnSummaryDTO }) {
  const t = useT();
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {summary.counts.map((c) => {
        const delta = c.count - c.previousCount;
        return (
          <StatTile
            key={c.level}
            label={t(`churn.summary.${c.level}`)}
            value={c.count}
            hint={
              c.previousCount !== undefined ? (
                <span className={delta > 0 ? 'ui-text-error' : delta < 0 ? 'ui-text-success' : undefined}>
                  {t('churn.summary.weekOverWeek', { delta: `${delta > 0 ? '+' : ''}${delta}` })}
                </span>
              ) : undefined
            }
          />
        );
      })}
    </div>
  );
}
