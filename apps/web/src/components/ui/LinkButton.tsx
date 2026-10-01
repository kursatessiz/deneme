import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { cx, look } from './types';
import type { UiSize, UiTone, UiVariant } from './types';

export type LinkButtonProps = ComponentProps<typeof Link> & {
  variant?: UiVariant;
  tone?: UiTone;
  size?: UiSize;
  icon?: ReactNode;
  block?: boolean;
};

/** A Next.js link drawn as a kit button, for navigation that looks like an action. */
export function LinkButton({ variant = 'solid', tone = 'theme', size = 'md', icon, block = false, className, children, ...rest }: LinkButtonProps) {
  return (
    <Link className={cx('pui-btn', look(variant, tone), size === 'sm' && 'ui-btn-sm', block && 'ui-btn-block', className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}
