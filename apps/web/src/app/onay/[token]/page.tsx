'use client';

import { use, useState } from 'react';
import { CONSENT_CONFIRMATION_TOKEN_PATTERN, type ConsentConfirmResultDTO } from '@platform/shared';
import { bffFetch } from '@/lib/session/client';
import { useT } from '@/components/i18n/I18nProvider';
import { LanguageSwitcher } from '@/components/i18n/LanguageSwitcher';

type State = 'ready' | 'done' | 'invalid' | 'error';

/**
 * Public double opt-in confirmation page (M3e, docs/PAZARLAMA_MODULU.md 6.4):
 * the link in the confirmation e-mail. Nothing is confirmed on page load
 * (mail scanners prefetch links); the person presses the button, which
 * posts the token to the API. The answer is neutral (confirmed or invalid)
 * and names nobody. Same flat surface and theme tokens as the unsubscribe
 * page.
 */
export default function ConsentConfirmPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const t = useT();
  const [state, setState] = useState<State>(CONSENT_CONFIRMATION_TOKEN_PATTERN.test(token) ? 'ready' : 'invalid');
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      const res = await bffFetch<ConsentConfirmResultDTO>(`public/consent/confirm/${token}`, { method: 'POST' });
      setState(res.result === 'CONFIRMED' ? 'done' : 'invalid');
    } catch {
      setState('error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12" style={{ backgroundColor: 'var(--color-background)' }}>
      <div
        className="w-full max-w-md p-8 border space-y-5"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-card)' }}
      >
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
            {t('consentConfirm.title')}
          </h1>
          <LanguageSwitcher mode="cookie" />
        </div>

        {(state === 'ready' || state === 'error') && (
          <div className="space-y-4">
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {t('consentConfirm.description')}
            </p>
            <button
              type="button"
              onClick={confirm}
              disabled={busy}
              className="w-full px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
              style={{ background: 'var(--gradient-brand, var(--color-primary))', color: 'var(--color-on-primary)', borderRadius: 'var(--radius-button)' }}
            >
              {t('consentConfirm.confirm')}
            </button>
            {state === 'error' && (
              <p className="text-xs" role="alert" style={{ color: 'var(--color-danger)' }}>
                {t('consentConfirm.error')}
              </p>
            )}
          </div>
        )}

        {state === 'done' && (
          <p className="text-sm" role="status" style={{ color: 'var(--color-text-primary)' }}>
            {t('consentConfirm.done')}
          </p>
        )}

        {state === 'invalid' && (
          <p className="text-sm" role="alert" style={{ color: 'var(--color-text-secondary)' }}>
            {t('consentConfirm.invalid')}
          </p>
        )}

        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {t('consentConfirm.note')}
        </p>
      </div>
    </main>
  );
}
