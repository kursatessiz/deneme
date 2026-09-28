'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PublicLanguagesDTO } from '@platform/shared';
import { bffFetch } from '@/lib/session/client';
import { setPwLocaleCookie } from '@/lib/i18n/client';
import { useLocale, useT } from './I18nProvider';

/**
 * Language picker. `mode="me"` (signed-in users, dashboard header) saves
 * the choice on the user via PUT /me/locale; `mode="cookie"` (login page,
 * no session yet) only sets the `pw_locale` cookie the root layout reads.
 * Either way the page refreshes so server components re-render in the new
 * locale.
 */
export function LanguageSwitcher({ mode, className }: { mode: 'me' | 'cookie'; className?: string }) {
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
  const [languages, setLanguages] = useState<PublicLanguagesDTO['items']>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    bffFetch<PublicLanguagesDTO>('i18n/languages')
      .then((res) => {
        if (!cancelled) setLanguages(res.items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function change(next: string) {
    if (next === locale) return;
    setSaving(true);
    try {
      if (mode === 'me') {
        await bffFetch('me/locale', { method: 'PUT', body: { locale: next } });
      } else {
        setPwLocaleCookie(next);
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (languages.length <= 1) return null;

  return (
    <select
      aria-label={t('language.label')}
      title={t('language.label')}
      value={locale}
      disabled={saving}
      onChange={(e) => change(e.target.value)}
      className={className}
    >
      {languages.map((l) => (
        <option key={l.code} value={l.code}>
          {l.nativeName}
        </option>
      ))}
    </select>
  );
}
