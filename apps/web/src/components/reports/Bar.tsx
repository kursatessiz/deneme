/** A single horizontal bar for a lightweight, dependency-free bar chart (no charting library, per CLAUDE.md design rules). */
export function Bar({ label, value, max, valueLabel }: { label: string; value: number; max: number; valueLabel: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3 text-xs">
      <div className="w-24 shrink-0 truncate" style={{ color: 'var(--color-text-secondary)' }} title={label}>
        {label}
      </div>
      <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-surface-muted)' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--gradient-brand)' }} />
      </div>
      <div className="w-24 shrink-0 text-right font-medium" style={{ color: 'var(--color-text-primary)' }}>
        {valueLabel}
      </div>
    </div>
  );
}

export function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-4" style={{ borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
      <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        {label}
      </div>
      <div className="text-xl font-bold mt-1" style={{ color: 'var(--color-text-primary)' }}>
        {value}
      </div>
    </div>
  );
}
