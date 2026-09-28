'use client';

import { use, useEffect, useState } from 'react';
import { bffFetch, BffError } from '@/lib/session/client';
import { useT } from '@/components/i18n/I18nProvider';
import { LanguageSwitcher } from '@/components/i18n/LanguageSwitcher';
import { isTrackingToken } from '@/lib/messaging/tokens';

interface UnsubscribeInfo {
  studioName: string;
  channel: 'EMAIL' | 'SMS' | 'WHATSAPP' | 'PUSH' | 'IN_APP';
  maskedAddress: string;
  alreadyUnsubscribed: boolean;
}

type State = 'loading' | 'ready' | 'done' | 'invalid';

/**
 * Public unsubscribe page (docs/MESAJLASMA.md, "Abonelikten çıkma"): the
 * link in every commercial email footer. Shows who is asking and for which
 * channel, then records the opt-out with one click. Mail clients use the
 * List-Unsubscribe one-click header, which posts to the API directly.
 */
export default function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const t = useT();
  const [state, setState] = useState<State>('loading');
  const [info, setInfo] = useState<UnsubscribeInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isTrackingToken(token)) {
      setState('invalid');
      return;
    }
    bffFetch<UnsubscribeInfo>(`m/u/${token}`)
      .then((res) => {
        setInfo(res);
        setState(res.alreadyUnsubscribed ? 'done' : 'ready');
      })
      .catch(() => setState('invalid'));
  }, [token]);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await bffFetch(`m/u/${token}`, { method: 'POST' });
      setState('done');
    } catch (err) {
      setError(err instanceof BffError && err.status === 404 ? t('messaging.unsubscribe.invalid') : t('messaging.unsubscribe.error'));
    } finally {
      setBusy(false);
    }
  }

  const channelLabel = info ? t(`messaging.channel.${info.channel}`) : '';

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12" style={{ backgroundColor: 'var(--color-background)' }}>
      <div
        className="w-full max-w-md p-8 border space-y-5"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-card)' }}
      >
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
            {t('messaging.unsubscribe.title')}
          </h1>
          <LanguageSwitcher mode="cookie" />
        </div>

        {state === 'loading' && (
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {t('common.loading')}
          </p>
        )}

        {state === 'invalid' && (
          <p className="text-sm" role="alert" style={{ color: 'var(--color-text-secondary)' }}>
            {t('messaging.unsubscribe.invalid')}
          </p>
        )}

        {state === 'ready' && info && (
          <div className="space-y-4">
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {t('messaging.unsubscribe.description', { studioName: info.studioName, channel: channelLabel })}
            </p>
            <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
              {t('messaging.unsubscribe.address', { address: info.maskedAddress })}
            </p>
            <button
              type="button"
              onClick={confirm}
              disabled={busy}
              className="w-full px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
              style={{ background: 'var(--gradient-brand, var(--color-primary))', color: 'var(--color-on-primary)', borderRadius: 'var(--radius-button)' }}
            >
              {t('messaging.unsubscribe.confirm')}
            </button>
            {error && (
              <p className="text-xs" role="alert" style={{ color: 'var(--color-danger, #b42318)' }}>
                {error}
              </p>
            )}
          </div>
        )}

        {state === 'done' && info && (
          <p className="text-sm" role="status" style={{ color: 'var(--color-text-primary)' }}>
            {info.alreadyUnsubscribed ? t('messaging.unsubscribe.already') : t('messaging.unsubscribe.done', { studioName: info.studioName })}
          </p>
        )}

        {state !== 'invalid' && (
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {t('messaging.unsubscribe.note')}
          </p>
        )}
      </div>
    </main>
  );
}
