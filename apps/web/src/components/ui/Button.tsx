'use client';

import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cx, look } from './types';
import type { UiSize, UiTone, UiVariant } from './types';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: UiVariant;
  tone?: UiTone;
  size?: UiSize;
  /** Shows a spinner in place of the icon and disables the button. */
  loading?: boolean;
  /** A Lucide icon element, rendered before the label at 16px. */
  icon?: ReactNode;
  /** Square button with only the icon; children become screen-reader text. Pass `aria-label` or children. */
  iconOnly?: boolean;
  /** Full width. */
  block?: boolean;
}

/** `pui-btn` + style + color. Primary actions are `solid theme` (flat, never a gradient). */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'solid', tone = 'theme', size = 'md', loading = false, icon, iconOnly = false, block = false, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  const label = iconOnly ? (children ? <span className="sr-only">{children}</span> : null) : children;
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx('pui-btn', look(variant, tone), size === 'sm' && 'ui-btn-sm', iconOnly && 'ui-btn-icon', block && 'ui-btn-block', className)}
      {...rest}
    >
      {loading ? <Loader2 className="ui-icon animate-spin" aria-hidden="true" /> : icon}
      {label}
    </button>
  );
});
