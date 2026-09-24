'use client';

import { DATE_RANGE_PRESETS, fromDateInputValue, resolveDateRangePreset, toDateInputValue, type DateRangePresetKey } from '@/lib/date-range';

const inputStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};

/** Preset buttons plus explicit from/to date inputs, all writing directly to the caller's from/to state. */
export function DateRangeFilter({
  from,
  to,
  onChange,
}: {
  from: Date | null;
  to: Date | null;
  onChange: (range: { from: Date | null; to: Date | null }) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1">
        {DATE_RANGE_PRESETS.map((preset: { key: DateRangePresetKey; label: string }) => (
          <button
            key={preset.key}
            type="button"
            onClick={() => onChange(resolveDateRangePreset(preset.key))}
            className="text-xs font-medium px-2.5 py-1.5"
            style={{ ...inputStyle, background: 'var(--color-surface-muted)' }}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <input
        type="date"
        value={from ? toDateInputValue(from) : ''}
        onChange={(e) => onChange({ from: fromDateInputValue(e.target.value), to })}
        className="text-xs px-2 py-1.5"
        style={inputStyle}
      />
      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        -
      </span>
      <input
        type="date"
        value={to ? toDateInputValue(to) : ''}
        onChange={(e) => onChange({ from, to: fromDateInputValue(e.target.value) })}
        className="text-xs px-2 py-1.5"
        style={inputStyle}
      />
    </div>
  );
}
