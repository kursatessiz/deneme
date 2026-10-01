'use client';

import { cx } from './types';

export interface TabItem {
  key: string;
  label: string;
}

export interface TabsProps {
  tabs: readonly TabItem[];
  active: string;
  onChange: (key: string) => void;
  /** Accessible name of the strip. */
  label?: string;
  className?: string;
}

/**
 * Section switcher under a page header. Plain buttons with aria-pressed (a
 * segmented control), so each tab stays reachable as a button by its label.
 */
export function Tabs({ tabs, active, onChange, label, className }: TabsProps) {
  return (
    <div className={cx('ui-tabs', className)} role={label ? 'group' : undefined} aria-label={label}>
      {tabs.map((tab) => (
        <button key={tab.key} type="button" aria-pressed={tab.key === active} onClick={() => onChange(tab.key)} className="pui-btn ui-tab">
          {tab.label}
        </button>
      ))}
    </div>
  );
}
