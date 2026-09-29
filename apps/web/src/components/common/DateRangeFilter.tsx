'use client';

import {
  DATE_RANGE_PRESET_MESSAGE_KEY,
  DATE_RANGE_PRESETS,
  fromDateInputValue,
  resolveDateRangePreset,
  toDateInputValue,
} from '@/lib/date-range';
import { useT } from '@/components/i18n/I18nProvider';

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
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1">
        {DATE_RANGE_PRESETS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(resolveDateRangePreset(key))}
            className="text-xs font-medium px-2.5 py-1.5"
            style={{ ...inputStyle, background: 'var(--color-surface-muted)' }}
          >
            {t(DATE_RANGE_PRESET_MESSAGE_KEY[key])}
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
