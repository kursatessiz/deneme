import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './types';

export interface AccordionProps extends HTMLAttributes<HTMLDivElement> {
  /** Paints the open item with the muted background. */
  highlighted?: boolean;
}

/** `pui-accordion`: stacked <details> items sharing borders. */
export function Accordion({ highlighted, className, ...rest }: AccordionProps) {
  return <div className={cx('pui-accordion', highlighted && 'pui-highlighted', className)} {...rest} />;
}

export interface AccordionItemProps {
  title: ReactNode;
  defaultOpen?: boolean;
  /** Items with the same name behave as an exclusive group. */
  name?: string;
  children: ReactNode;
}

export function AccordionItem({ title, defaultOpen, name, children }: AccordionItemProps) {
  return (
    <details className="pui-accordion-item" open={defaultOpen} name={name}>
      <summary>{title}</summary>
      <div>{children}</div>
    </details>
  );
}
