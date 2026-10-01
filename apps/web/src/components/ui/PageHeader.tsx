import type { ReactNode } from 'react';
import { cx } from './types';

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Buttons on the right; they wrap under the title on narrow screens. */
  actions?: ReactNode;
  className?: string;
}

/** Page title (h2, under the shell's h1), one-line description and actions. */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cx('flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="grid gap-1">
        <h2 className="ui-title">{title}</h2>
        {description ? <p className="ui-text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
