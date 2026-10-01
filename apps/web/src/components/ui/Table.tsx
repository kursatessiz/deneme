import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cx } from './types';

export interface TableProps extends HTMLAttributes<HTMLTableElement> {
  striped?: boolean;
  hoverable?: boolean;
}

/** `pui-table`: row dividers, muted header text. Wrap it in a Card for the outer border. */
export function Table({ striped, hoverable, className, ...rest }: TableProps) {
  return <table className={cx('pui-table', striped && 'pui-striped', hoverable && 'pui-hoverable', className)} {...rest} />;
}

export function Thead(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead {...props} />;
}

export function Tbody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

export function Tr(props: HTMLAttributes<HTMLTableRowElement>) {
  return <tr {...props} />;
}

export function Th({ scope = 'col', ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th scope={scope} {...rest} />;
}

export function Td(props: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td {...props} />;
}
