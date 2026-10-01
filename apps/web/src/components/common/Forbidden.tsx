'use client';

import { ShieldAlert } from 'lucide-react';
import { useT } from '@/components/i18n/I18nProvider';
import { EmptyState } from '@/components/ui/EmptyState';

/** Shown on a page the active membership's permissions do not cover. */
export function Forbidden() {
  const t = useT();
  return (
    <EmptyState
      headingLevel={2}
      icon={<ShieldAlert className="w-10 h-10" aria-hidden="true" />}
      title={t('common.forbidden.title')}
      description={t('common.forbidden.description')}
    />
  );
}
