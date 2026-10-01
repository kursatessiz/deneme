'use client';

import { useId, useRef } from 'react';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { anchorName, anchorStyle, cx, look } from './types';
import type { UiSize, UiTone, UiVariant } from './types';

export interface DropdownProps {
  /** Content of the trigger button. */
  label: ReactNode;
  /** Accessible name of the trigger when `label` is only an icon. */
  ariaLabel?: string;
  variant?: UiVariant;
  tone?: UiTone;
  size?: UiSize;
  iconOnly?: boolean;
  /** Which edge of the trigger the menu lines up with. */
  align?: 'start' | 'end';
  /** Opens above the trigger. */
  top?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * The kit's popover dropdown: a native `popover="auto"` panel opened by
 * `popovertarget` (light dismiss and Escape come from the browser) and
 * placed under the trigger with CSS anchor positioning.
 */
export function Dropdown({ label, ariaLabel, variant = 'outline', tone = 'surface', size = 'md', iconOnly = false, align = 'start', top = false, className, children }: DropdownProps) {
  const id = useId();
  const popoverId = `dropdown${id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const anchor = anchorName(id);
  return (
    <>
      <button
        type="button"
        popoverTarget={popoverId}
        aria-label={ariaLabel}
        aria-haspopup="true"
        className={cx('pui-btn', look(variant, tone), size === 'sm' && 'ui-btn-sm', iconOnly && 'ui-btn-icon', className)}
        style={anchorStyle('anchor', anchor)}
      >
        {label}
      </button>
      <div id={popoverId} popover="auto" className={cx('pui-dropdown', top && 'pui-top', align === 'end' && 'pui-align-end')} style={anchorStyle('target', anchor)}>
        {children}
      </div>
    </>
  );
}

/** One action in a Dropdown; closes the menu after running. */
export function DropdownItem({ className, onClick, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={ref}
      type={type}
      className={cx('pui-btn pui-link pui-surface ui-nav-link', className)}
      onClick={(e) => {
        onClick?.(e);
        const panel = ref.current?.closest<HTMLElement>('[popover]');
        if (panel && typeof panel.hidePopover === 'function' && panel.matches(':popover-open')) panel.hidePopover();
      }}
      {...rest}
    />
  );
}

/** Non-interactive content inside a Dropdown (a setting row, a caption). */
export function DropdownSection({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('px-3 py-2', className)} {...rest} />;
}
