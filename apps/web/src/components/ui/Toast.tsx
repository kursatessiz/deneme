'use client';

import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';
import { cx, look } from './types';
import type { UiTone } from './types';

/** `pui-float`: fixed corner container for toasts. */
export function Float({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('pui-float grid gap-2', className)}>{children}</div>;
}

export interface ToastProps {
  tone?: UiTone;
  /** Accessible name of the dismiss button; omit to hide it. */
  closeLabel?: string;
  onClose?: () => void;
  children: ReactNode;
}

/** A short status message on the page color, announced politely. */
export function Toast({ tone = 'surface', closeLabel, onClose, children }: ToastProps) {
  return (
    <div role="status" className={cx('pui-card flex items-center gap-3 px-4 py-2', look('outline', tone))}>
      <span>{children}</span>
      {onClose && closeLabel ? (
        <Button variant="link" tone="muted" size="sm" iconOnly aria-label={closeLabel} onClick={onClose} icon={<X className="ui-icon" aria-hidden="true" />} />
      ) : null}
    </div>
  );
}
