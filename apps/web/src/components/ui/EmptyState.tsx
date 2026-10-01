import type { ReactNode } from 'react';
import { cx } from './types';

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  /** A Lucide icon element. */
  icon?: ReactNode;
  /** A button or link. */
  action?: ReactNode;
  /** Heading level of the title (defaults to h3). */
  headingLevel?: 2 | 3;
  className?: string;
}

/** Dashed, centered placeholder for an empty list or a blocked page. */
export function EmptyState({ title, description, icon, action, headingLevel = 3, className }: EmptyStateProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div className={cx('ui-empty', className)}>
      {icon ? <span className="ui-text-muted">{icon}</span> : null}
      <Heading className="ui-heading">{title}</Heading>
      {description ? <p className="ui-caption max-w-sm">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
