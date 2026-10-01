import type { HTMLAttributes, LiHTMLAttributes } from 'react';
import { cx } from './types';

export interface ListProps extends HTMLAttributes<HTMLUListElement> {
  striped?: boolean;
  hoverable?: boolean;
}

/** `pui-list`: plain rows with the kit's padding; no bullets. */
export function List({ striped, hoverable, className, ...rest }: ListProps) {
  return <ul className={cx('pui-list', striped && 'pui-striped', hoverable && 'pui-hoverable', className)} {...rest} />;
}

export function ListItem({ className, ...rest }: LiHTMLAttributes<HTMLLIElement>) {
  return <li className={cx('pui-list-item', className)} {...rest} />;
}
