'use client';

import { useT } from '@/components/i18n/I18nProvider';
import { ErrorScreen } from '@/components/errors/ErrorScreen';

/** Error boundary for every route under the root layout (docs/HATA_RAPORLAMA.md). */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  return <ErrorScreen error={error} reset={reset} t={t} />;
}
