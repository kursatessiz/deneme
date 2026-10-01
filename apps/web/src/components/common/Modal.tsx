'use client';

import { Modal as UiModal } from '@/components/ui/Modal';
import { useT } from '@/components/i18n/I18nProvider';

/**
 * Existing modal API (rendered when open, removed when closed) on top of the
 * native-dialog Modal of the component library.
 */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const t = useT();
  return (
    <UiModal open title={title} onClose={onClose} closeLabel={t('common.close')}>
      {children}
    </UiModal>
  );
}
