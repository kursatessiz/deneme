'use client';

import { useId } from 'react';
import type { ReactNode } from 'react';
import { Button, Checkbox, Input, Select, Textarea } from '@/components/ui';

/**
 * Form controls of the marketing screens (brand kit, AI studio, calendar):
 * component-library inputs, each one tied to its visible label so screen
 * readers and tests address it by its text.
 */

/**
 * Label plus optional hint for one control. The label is bound with
 * `htmlFor`, and the hint is linked with `aria-describedby` instead of being
 * nested in the label, so the control's accessible name stays exactly the
 * label text (screen readers and `getByLabel` in the browser tests).
 */
function Label({ label, hint, children }: { label: string; hint?: ReactNode; children: (ids: { id: string; describedBy?: string }) => ReactNode }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="pui-field-group">
      <div className="flex items-baseline justify-between gap-2 ui-strong ui-small">
        <label htmlFor={id}>{label}</label>
        {hint && (
          <span className="ui-text-muted" id={hintId}>
            {hint}
          </span>
        )}
      </div>
      {children({ id, ...(hintId ? { describedBy: hintId } : {}) })}
    </div>
  );
}

export function AreaField({
  label,
  value,
  onChange,
  rows = 3,
  hint,
  disabled,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  hint?: ReactNode;
  disabled?: boolean;
  invalid?: boolean;
}) {
  return (
    <Label label={label} hint={hint}>
      {({ id, describedBy }) => (
        <Textarea
          id={id}
          aria-describedby={describedBy}
          value={value}
          rows={rows}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          invalid={invalid}
        />
      )}
    </Label>
  );
}

export function InputField({
  label,
  value,
  onChange,
  type = 'text',
  hint,
  disabled,
  invalid,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  hint?: ReactNode;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
}) {
  return (
    <Label label={label} hint={hint}>
      {({ id, describedBy }) => (
        <Input
          id={id}
          aria-describedby={describedBy}
          type={type}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          invalid={invalid}
        />
      )}
    </Label>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  disabled?: boolean;
}) {
  return (
    <Label label={label}>
      {({ id }) => (
        <Select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      )}
    </Label>
  );
}

export function CheckField({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <Checkbox label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />;
}

/** A plain text button styled as a link; for row actions that must not compete with the primary button. */
export function LinkButton({ children, onClick, disabled, danger }: { children: ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <Button variant="link" tone={danger ? 'error' : 'surface'} size="sm" onClick={onClick} disabled={disabled}>
      {children}
    </Button>
  );
}
