'use client';

import { ShieldAlert } from 'lucide-react';
import { useT } from '@/components/i18n/I18nProvider';

/** Shown on a page the active membership's permissions do not cover. */
export function Forbidden() {
  const t = useT();
  return (
    <div
      className="flex flex-col items-center justify-center text-center py-24 rounded-2xl border"
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
    >
      <ShieldAlert className="w-10 h-10 mb-4" style={{ color: 'var(--color-text-muted)' }} />
      <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
        {t('common.forbidden.title')}
      </h2>
      <p className="text-sm mt-1 max-w-sm" style={{ color: 'var(--color-text-secondary)' }}>
        {t('common.forbidden.description')}
      </p>
    </div>
  );
}
