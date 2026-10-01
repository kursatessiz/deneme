import { forwardRef } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { cx } from './types';

export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: ReactNode;
}

/** `pui-radio`; with `label` it is wrapped in a clickable <label>. */
export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio({ label, className, ...rest }, ref) {
  const input = <input ref={ref} type="radio" className={cx('pui-radio', !label && className)} {...rest} />;
  if (!label) return input;
  return (
    <label className={cx('inline-flex items-center gap-2', className)}>
      {input}
      <span>{label}</span>
    </label>
  );
});
