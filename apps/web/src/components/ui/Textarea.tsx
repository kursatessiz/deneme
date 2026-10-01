import { forwardRef } from 'react';
import type { TextareaHTMLAttributes } from 'react';
import { cx } from './types';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ invalid, className, ...rest }, ref) {
  return <textarea ref={ref} aria-invalid={invalid || undefined} className={cx('pui-input', className)} {...rest} />;
});
