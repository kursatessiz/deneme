import type { HTMLAttributes } from 'react';
import { cx, look } from './types';
import type { UiTone, UiVariant } from './types';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: UiVariant;
  tone?: UiTone;
}

/** `pui-badge`: small status label. */
export function Badge({ variant = 'soft', tone = 'muted', className, ...rest }: BadgeProps) {
  return <span className={cx('pui-badge', look(variant, tone), className)} {...rest} />;
}
