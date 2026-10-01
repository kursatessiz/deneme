import type { ReactNode } from 'react';
import { cx, look } from './types';
import type { UiTone, UiVariant } from './types';

export interface TimelineProps {
  /** Lays the checkpoints out in a row (`pui-group-row`). */
  horizontal?: boolean;
  className?: string;
  children: ReactNode;
}

/** `pui-timeline`: checkpoints joined by a hairline. */
export function Timeline({ horizontal, className, children }: TimelineProps) {
  return <ol className={cx('pui-timeline', horizontal && 'pui-group-row', className)}>{children}</ol>;
}

export interface TimelineItemProps {
  /** Content of the round marker: an icon or a step number. */
  marker: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  variant?: UiVariant;
  tone?: UiTone;
}

export function TimelineItem({ marker, title, description, variant = 'soft', tone = 'theme' }: TimelineItemProps) {
  return (
    <li className="pui-checkpoint">
      <span className={cx('pui-checkpoint-icon', look(variant, tone))} aria-hidden="true">
        {marker}
      </span>
      <div className="grid gap-1">
        <span className="ui-heading">{title}</span>
        {description ? <span className="ui-caption">{description}</span> : null}
      </div>
    </li>
  );
}
