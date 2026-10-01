'use client';

import { use, useState } from 'react';
import { CONSENT_CONFIRMATION_TOKEN_PATTERN, type ConsentConfirmResultDTO } from '@platform/shared';
import { bffFetch } from '@/lib/session/client';
import { useT } from '@/components/i18n/I18nProvider';
import { LanguageSwitcher } from '@/components/i18n/LanguageSwitcher';
import { PublicShell } from '@/components/common/PublicShell';
import { Button } from '@/components/ui';

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
    <PublicShell>
      <div className="flex items-start justify-between gap-4">
        <h1 className="ui-title">{t('consentConfirm.title')}</h1>
        <LanguageSwitcher mode="cookie" className="pui-input ui-btn-sm" />
      </div>

      {(state === 'ready' || state === 'error') && (
        <div className="grid gap-4">
          <p className="ui-text-muted">{t('consentConfirm.description')}</p>
          <Button block onClick={confirm} disabled={busy}>
            {t('consentConfirm.confirm')}
          </Button>
          {state === 'error' && (
            <p className="ui-caption ui-text-error" role="alert">
              {t('consentConfirm.error')}
            </p>
          )}
        </div>
      )}

      {state === 'done' && <p role="status">{t('consentConfirm.done')}</p>}

      {state === 'invalid' && (
        <p className="ui-text-muted" role="alert">
          {t('consentConfirm.invalid')}
        </p>
      )}

      <p className="ui-caption">{t('consentConfirm.note')}</p>
    </PublicShell>
  );
}
