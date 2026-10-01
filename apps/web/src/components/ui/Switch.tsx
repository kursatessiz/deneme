import { forwardRef } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { cx } from './types';

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'checked'> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Row label, drawn on the left like the kit's "Dark mode" row. */
  label?: ReactNode;
}

/**
 * `pui-switch`: a checkbox with role="switch" and an explicit aria-checked,
 * so assistive tech and tests read it as an on/off switch.
 */
export const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch({ checked, onCheckedChange, label, className, disabled, ...rest }, ref) {
  const input = (
    <input
      ref={ref}
      type="checkbox"
      role="switch"
      aria-checked={checked}
      checked={checked}
      disabled={disabled}
      onChange={(e) => onCheckedChange(e.target.checked)}
      className={cx('pui-switch', !label && className)}
      {...rest}
    />
  );
  if (!label) return input;
  return (
    <label className={cx('flex items-center justify-between gap-3 select-none', className)} style={disabled ? { opacity: 0.5 } : undefined}>
      <span>{label}</span>
      {input}
    </label>
  );
});
