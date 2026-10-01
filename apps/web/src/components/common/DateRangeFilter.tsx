'use client';

import {
  DATE_RANGE_PRESET_MESSAGE_KEY,
  DATE_RANGE_PRESETS,
  fromDateInputValue,
  resolveDateRangePreset,
  toDateInputValue,
} from '@/lib/date-range';
import { useT } from '@/components/i18n/I18nProvider';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

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
          <Button key={key} variant="soft" tone="muted" size="sm" onClick={() => onChange(resolveDateRangePreset(key))}>
            {t(DATE_RANGE_PRESET_MESSAGE_KEY[key])}
          </Button>
        ))}
      </div>
      <Input type="date" value={from ? toDateInputValue(from) : ''} onChange={(e) => onChange({ from: fromDateInputValue(e.target.value), to })} />
      <span className="ui-text-muted">-</span>
      <Input type="date" value={to ? toDateInputValue(to) : ''} onChange={(e) => onChange({ from, to: fromDateInputValue(e.target.value) })} />
    </div>
  );
}
