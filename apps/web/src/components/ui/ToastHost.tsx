'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useT } from '@/components/i18n/I18nProvider';
import { Float, Toast } from './Toast';
import type { UiTone } from './types';

interface ToastItem {
  id: number;
  message: string;
  tone: UiTone;
}

interface ToastApi {
  /** Shows a short message in the corner; `message` must already be translated. Errors default to the error tone. */
  show: (message: string, tone?: UiTone) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
const AUTO_DISMISS_MS = 6000;

/** Global toast stack: the in-app replacement for window.alert (docs/I18N.md). Mounted once in the root document. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => setItems((all) => all.filter((i) => i.id !== id)), []);
  const show = useCallback((message: string, tone: UiTone = 'surface') => {
    setItems((all) => [...all, { id: Date.now() + Math.random(), message, tone }]);
  }, []);
  const api = useMemo<ToastApi>(() => ({ show, error: (message) => show(message, 'error') }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {items.length > 0 ? (
        <Float>
          {items.map((item) => (
            <TimedToast key={item.id} item={item} closeLabel={t('common.close')} onDone={dismiss} />
          ))}
        </Float>
      ) : null}
    </ToastContext.Provider>
  );
}

function TimedToast({ item, closeLabel, onDone }: { item: ToastItem; closeLabel: string; onDone: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDone(item.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [item.id, onDone]);
  return (
    <Toast tone={item.tone} closeLabel={closeLabel} onClose={() => onDone(item.id)}>
      {item.message}
    </Toast>
  );
}

/** `const toast = useToast(); toast.error(err instanceof BffError ? err.message : t('x.failed'));` */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
