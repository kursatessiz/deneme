import type { HTMLAttributes } from 'react';
import { cx } from './types';

/** `pui-input-group`: an input joined with addons (currency, unit, icon). */
export function InputGroup({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('pui-input-group', className)} {...rest} />;
}

/** `pui-addon`: the muted part of an input group. */
export function Addon({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cx('pui-addon', className)} {...rest} />;
}
