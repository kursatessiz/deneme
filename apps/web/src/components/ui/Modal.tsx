'use client';

import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';
import { cx } from './types';

export interface ModalProps {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  /** Accessible name of the close button (translated by the caller). */
  closeLabel: string;
  /** Action row under the content. */
  footer?: ReactNode;
  /** Wider panel for forms with two columns. */
  wide?: boolean;
  children: ReactNode;
}

/**
 * `pui-modal`: a native <dialog> opened with showModal(), so focus is
 * trapped, the page behind is inert and Escape closes it (routed to
 * `onClose`; the caller stays in control of `open`).
 */
export function Modal({ open, title, onClose, closeLabel, footer, wide = false, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="pui-modal w-full"
      style={wide ? { maxWidth: 'min(48rem, calc(100vw - 2rem))' } : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="pui-card">
        <div className="flex items-center justify-between gap-3 px-4 pt-4">
          <h3 id={titleId} className="ui-heading">
            {title}
          </h3>
          <Button variant="link" tone="muted" size="sm" iconOnly aria-label={closeLabel} onClick={onClose} icon={<X className="ui-icon" aria-hidden="true" />} />
        </div>
        <div className={cx('pui-card-content')}>{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 px-4 pb-4">{footer}</div> : null}
      </div>
    </dialog>
  );
}
