'use client';

import { useId } from 'react';
import type { ReactNode } from 'react';

/**
 * Form controls of the marketing screens (brand kit, AI studio, calendar):
 * flat inputs on the neutral admin tokens, each one wrapped in its own
 * label so screen readers and tests address it by its visible text.
 */

const controlStyle: React.CSSProperties = {
  borderColor: 'var(--color-border)',
  borderRadius: 'var(--radius-input)',
  backgroundColor: 'var(--color-background)',
  color: 'var(--color-text-primary)',
};

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
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
        <label htmlFor={id}>{label}</label>
        {hint && (
          <span id={hintId} style={{ color: 'var(--color-text-muted)' }}>
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
        <textarea
          id={id}
          aria-describedby={describedBy}
          value={value}
          rows={rows}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 text-sm border outline-none disabled:opacity-60"
          style={{ ...controlStyle, ...(invalid ? { borderColor: 'var(--color-danger)' } : {}) }}
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
        <input
          id={id}
          aria-describedby={describedBy}
          type={type}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 text-sm border outline-none disabled:opacity-60"
          style={{ ...controlStyle, ...(invalid ? { borderColor: 'var(--color-danger)' } : {}) }}
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
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 text-sm border outline-none disabled:opacity-60"
          style={controlStyle}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Label>
  );
}

export function CheckField({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text-primary)', opacity: disabled ? 0.6 : 1 }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** A plain text button styled as a link; for row actions that must not compete with the primary button. */
export function LinkButton({ children, onClick, disabled, danger }: { children: ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="text-xs font-medium underline disabled:opacity-50"
      style={{ color: danger ? 'var(--color-danger)' : 'var(--color-text-secondary)' }}
    >
      {children}
    </button>
  );
}
