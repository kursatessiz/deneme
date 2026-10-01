'use client';

import { use, useEffect, useState } from 'react';
import { bffFetch, BffError } from '@/lib/session/client';
import { useT } from '@/components/i18n/I18nProvider';
import { LanguageSwitcher } from '@/components/i18n/LanguageSwitcher';
import { PublicShell } from '@/components/common/PublicShell';
import { Button } from '@/components/ui';
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
    <PublicShell>
      <div className="flex items-start justify-between gap-4">
        <h1 className="ui-title">{t('messaging.unsubscribe.title')}</h1>
        <LanguageSwitcher mode="cookie" className="pui-input ui-btn-sm" />
      </div>

      {state === 'loading' && <p className="ui-text-muted">{t('common.loading')}</p>}

      {state === 'invalid' && (
        <p className="ui-text-muted" role="alert">
          {t('messaging.unsubscribe.invalid')}
        </p>
      )}

      {state === 'ready' && info && (
        <div className="grid gap-4">
          <p className="ui-text-muted">{t('messaging.unsubscribe.description', { studioName: info.studioName, channel: channelLabel })}</p>
          <p className="ui-strong">{t('messaging.unsubscribe.address', { address: info.maskedAddress })}</p>
          <Button block onClick={confirm} disabled={busy}>
            {t('messaging.unsubscribe.confirm')}
          </Button>
          {error && (
            <p className="ui-caption ui-text-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}

      {state === 'done' && info && (
        <p role="status">{info.alreadyUnsubscribed ? t('messaging.unsubscribe.already') : t('messaging.unsubscribe.done', { studioName: info.studioName })}</p>
      )}

      {state !== 'invalid' && <p className="ui-caption">{t('messaging.unsubscribe.note')}</p>}
    </PublicShell>
  );
}
