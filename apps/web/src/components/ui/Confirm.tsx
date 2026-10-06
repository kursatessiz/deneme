'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useT } from '@/components/i18n/I18nProvider';
import { Button } from './Button';
import { Input } from './Input';
import { Modal } from './Modal';

export interface ConfirmOptions {
  /** The question shown in the dialog body (already translated by the caller). */
  message: string;
  /** Dialog title; defaults to the translated `common.confirmTitle`. */
  title?: string;
  /** Confirm button label; defaults to the translated `common.confirm`. */
  confirmLabel?: string;
  /** Destructive action: the confirm button uses the error tone. */
  danger?: boolean;
}

export interface PromptOptions extends ConfirmOptions {
  /** Label of the text field. */
  inputLabel: string;
  /** Placeholder of the text field. */
  placeholder?: string;
}

interface PendingDialog {
  options: ConfirmOptions | PromptOptions;
  prompt: boolean;
  resolve: (value: boolean | string | null) => void;
}

interface ConfirmApi {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** Resolves with the entered text, or null when cancelled. */
  prompt: (options: PromptOptions) => Promise<string | null>;
}

const ConfirmContext = createContext<ConfirmApi | null>(null);

/**
 * In-app replacement for window.confirm / window.prompt: a Modal whose labels
 * come from i18n, so it follows the selected app language (docs/I18N.md).
 * Mounted once in the root document; screens call `useConfirm()`.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [pending, setPending] = useState<PendingDialog | null>(null);
  const [text, setText] = useState('');
  const last = useRef<PendingDialog | null>(null);
  if (pending) last.current = pending;

  const ask = useCallback((options: ConfirmOptions | PromptOptions, prompt: boolean) => {
    return new Promise<boolean | string | null>((resolve) => {
      setText('');
      setPending({ options, prompt, resolve });
    });
  }, []);

  const api = useMemo<ConfirmApi>(
    () => ({
      confirm: async (options) => (await ask(options, false)) === true,
      prompt: async (options) => {
        const value = await ask(options, true);
        return typeof value === 'string' ? value : null;
      },
    }),
    [ask],
  );

  function settle(value: boolean | string | null) {
    pending?.resolve(value);
    setPending(null);
  }

  const shown = pending ?? last.current;
  const options = shown?.options;
  const isPrompt = shown?.prompt ?? false;
  const danger = options?.danger ?? false;
  const confirmLabel = options?.confirmLabel ?? t('common.confirm');

  return (
    <ConfirmContext.Provider value={api}>
      {children}
      <Modal
        open={pending !== null}
        title={options?.title ?? t('common.confirmTitle')}
        closeLabel={t('common.close')}
        onClose={() => settle(isPrompt ? null : false)}
        footer={
          <>
            <Button variant="outline" tone="surface" onClick={() => settle(isPrompt ? null : false)}>
              {t('common.cancel')}
            </Button>
            <Button variant={danger ? 'outline' : 'solid'} tone={danger ? 'error' : 'theme'} onClick={() => settle(isPrompt ? text : true)}>
              {confirmLabel}
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <p>{options?.message}</p>
          {isPrompt && options && 'inputLabel' in options ? (
            <label className="grid gap-1">
              <span>{options.inputLabel}</span>
              <Input value={text} placeholder={options.placeholder} onChange={(e) => setText(e.target.value)} autoFocus />
            </label>
          ) : null}
        </div>
      </Modal>
    </ConfirmContext.Provider>
  );
}

/** `const { confirm } = useConfirm(); if (!(await confirm({ message: t('x.confirmDelete'), danger: true }))) return;` */
export function useConfirm(): ConfirmApi {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside ConfirmProvider');
  return ctx;
}
