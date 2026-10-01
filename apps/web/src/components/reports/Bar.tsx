import { cx } from '@/components/ui/types';

export { StatTile } from '@/components/ui/StatTile';

/** A single horizontal bar for a lightweight, dependency-free bar chart (no charting library, per CLAUDE.md design rules). */
export function Bar({ label, value, max, valueLabel }: { label: string; value: number; max: number; valueLabel: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={cx('flex items-center gap-3 ui-caption')}>
      <div className="w-24 shrink-0 truncate" title={label}>
        {label}
      </div>
      <div className="flex-1 h-2.5 overflow-hidden ui-panel">
        <div className="h-full ui-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="w-24 shrink-0 text-right ui-strong">{valueLabel}</div>
    </div>
  );
}
