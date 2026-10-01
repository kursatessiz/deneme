import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';
import { cx } from './types';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

/** `pui-input` text field. `invalid` sets aria-invalid, which the kit paints in the error color. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ invalid, className, ...rest }, ref) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={cx('pui-input', className)} {...rest} />;
});
