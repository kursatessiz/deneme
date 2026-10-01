import Link from 'next/link';
import type { AnchorHTMLAttributes, ComponentProps, ReactNode } from 'react';
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

export type AnchorButtonProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: UiVariant;
  tone?: UiTone;
  size?: UiSize;
  icon?: ReactNode;
  block?: boolean;
};

/** A plain <a> drawn as a kit button, for file downloads and external links that must not go through the Next.js router. */
export function AnchorButton({ variant = 'solid', tone = 'theme', size = 'md', icon, block = false, className, children, ...rest }: AnchorButtonProps) {
  return (
    <a className={cx('pui-btn', look(variant, tone), size === 'sm' && 'ui-btn-sm', block && 'ui-btn-block', className)} {...rest}>
      {icon}
      {children}
    </a>
  );
}
