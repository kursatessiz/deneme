import type { ReactNode } from 'react';
import { cx } from './types';

export interface FieldGroupProps {
  label: ReactNode;
  /** Helper text under the control. */
  hint?: ReactNode;
  /** Error text; replaces the hint. Also pass `invalid` to the control so the kit colors both. */
  error?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * `pui-field-group`: label, control, hint. The wrapper is a <label>, so the
 * control's accessible name is the label text (Playwright getByLabel works).
 */
export function FieldGroup({ label, hint, error, className, children }: FieldGroupProps) {
  const note = error ?? hint;
  return (
    <label className={cx('pui-field-group', className)}>
      <span>{label}</span>
      {children}
      {note ? <small>{note}</small> : null}
    </label>
  );
}
