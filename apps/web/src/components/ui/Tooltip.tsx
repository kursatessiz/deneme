'use client';

import { useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { anchorName, anchorStyle, cx } from './types';

export interface TooltipProps {
  content: ReactNode;
  side?: 'top' | 'bottom' | 'start' | 'end';
  children: ReactNode;
}

/**
 * `pui-tooltip`: a manual popover shown on hover and focus of its trigger
 * and placed with CSS anchor positioning. The trigger is described by the
 * tooltip text for screen readers.
 */
export function Tooltip({ content, side = 'top', children }: TooltipProps) {
  const id = useId();
  const tipId = `tip${id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const anchor = anchorName(id);
  const ref = useRef<HTMLSpanElement>(null);
  const show = () => {
    const el = ref.current;
    if (el && typeof el.showPopover === 'function' && !el.matches(':popover-open')) el.showPopover();
  };
  const hide = () => {
    const el = ref.current;
    if (el && typeof el.hidePopover === 'function' && el.matches(':popover-open')) el.hidePopover();
  };
  return (
    <span className="inline-flex" style={anchorStyle('anchor', anchor)} aria-describedby={tipId} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      <span
        ref={ref}
        id={tipId}
        role="tooltip"
        popover="manual"
        className={cx('pui-tooltip', side === 'bottom' && 'pui-bottom', side === 'start' && 'pui-start', side === 'end' && 'pui-end')}
        style={anchorStyle('target', anchor)}
      >
        {content}
      </span>
    </span>
  );
}
