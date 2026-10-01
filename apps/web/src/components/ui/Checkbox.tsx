import { forwardRef } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { cx } from './types';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: ReactNode;
}

/** `pui-checkbox`; with `label` it is wrapped in a clickable <label>. */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ label, className, ...rest }, ref) {
  const input = <input ref={ref} type="checkbox" className={cx('pui-checkbox', !label && className)} {...rest} />;
  if (!label) return input;
  return (
    <label className={cx('inline-flex items-center gap-2', className)}>
      {input}
      <span>{label}</span>
    </label>
  );
});
