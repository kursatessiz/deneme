import type { ReactNode } from 'react';
import { cx, look } from './types';
import type { UiTone } from './types';

export interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  /** One line under the value: a comparison or a unit. */
  hint?: ReactNode;
  /** A Lucide icon element, shown in a soft badge of `tone`. */
  icon?: ReactNode;
  tone?: UiTone;
  className?: string;
}

/** A single figure in a card: label, value, hint. */
export function StatTile({ label, value, hint, icon, tone = 'theme', className }: StatTileProps) {
  return (
    <div className={cx('pui-card', className)}>
      <div className="pui-card-content">
        <div className="flex items-center justify-between gap-2">
          <span className="ui-caption">{label}</span>
          {icon ? <span className={cx('pui-badge', look('soft', tone))}>{icon}</span> : null}
        </div>
        <span className="ui-stat-value">{value}</span>
        {hint ? <span className="ui-caption">{hint}</span> : null}
      </div>
    </div>
  );
}
