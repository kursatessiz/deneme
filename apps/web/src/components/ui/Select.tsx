import { forwardRef } from 'react';
import type { SelectHTMLAttributes } from 'react';
import { cx } from './types';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

/** Native select drawn as `pui-input` (the kit adds the caret). */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ invalid, className, ...rest }, ref) {
  return <select ref={ref} aria-invalid={invalid || undefined} className={cx('pui-input', className)} {...rest} />;
});
