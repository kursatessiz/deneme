import { forwardRef } from 'react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './types';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  as?: 'div' | 'section' | 'article';
}

/** `pui-card`: page-colored surface, 1px border, radius 1.5x base. Never nest a card in a card. */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card({ as = 'div', className, ...rest }, ref) {
  const Tag = as;
  return <Tag ref={ref} className={cx('pui-card', className)} {...rest} />;
});

export interface CardHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  /** Right-aligned content, e.g. a link or a small button. */
  actions?: ReactNode;
}

/** The optional muted header strip of a card. */
export function CardHeader({ title, actions, className, children, ...rest }: CardHeaderProps) {
  return (
    <div className={cx('pui-card-header flex items-center justify-between gap-3', className)} {...rest}>
      {title !== undefined ? <h3 className="ui-heading">{title}</h3> : null}
      {children}
      {actions}
    </div>
  );
}

/** Card body: a grid with the kit's 12px gap and 16px padding. */
export function CardContent({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('pui-card-content', className)} {...rest} />;
}
