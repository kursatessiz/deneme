'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { ErrorSettingsDTO, ErrorSettingsUpdate } from '@platform/shared';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/DataState';
import { useT } from '@/components/i18n/I18nProvider';

const inputStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  borderColor: 'var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};
const card: React.CSSProperties = { borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' };
const primary: React.CSSProperties = { borderRadius: 'var(--radius-button)', backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' };
const secondary: React.CSSProperties = { borderRadius: 'var(--radius-button)', borderColor: 'var(--color-border)' };

/** Super admin: spike thresholds, alert cooldown and the signed webhook and Slack destinations (H3). */
export default function AdminErrorSettingsPage() {
  const t = useT();
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, error, forbidden } = useBff<ErrorSettingsDTO>('admin/errors/settings', null, refreshKey);
  const [enabled, setEnabled] = useState(true);
  const [ratio, setRatio] = useState('');
  const [minWindow, setMinWindow] = useState('');
  const [minBaseline, setMinBaseline] = useState('');
  const [floor, setFloor] = useState('');
  const [cooldown, setCooldown] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [webhookOn, setWebhookOn] = useState(true);
  const [slackUrl, setSlackUrl] = useState('');
  const [slackOn, setSlackOn] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    setEnabled(data.spike.enabled);
    setRatio(String(data.spike.ratio));
    setMinWindow(String(data.spike.minWindowCount));
    setMinBaseline(String(data.spike.minBaselineEvents));
    setFloor(String(data.spike.absoluteFloor));
    setCooldown(String(data.cooldownMinutes));
    setWebhookOn(data.webhook.enabled);
    setSlackOn(data.slack.enabled);
  }, [data]);

  if (forbidden) return <EmptyState title={t('adminErrors.accessDenied')} />;
  if (loading && !data) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;

  const send = async (body: ErrorSettingsUpdate) => {
    setBusy(true);
    setMessage(null);
    try {
      await bffFetch('admin/errors/settings', { method: 'PATCH', body });
      setWebhookUrl('');
      setWebhookSecret('');
      setSlackUrl('');
      setMessage(t('adminErrors.settings.saved'));
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setMessage(err instanceof BffError ? err.message : t('adminErrors.settings.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const body: ErrorSettingsUpdate = {
      spike: { enabled, ratio: Number(ratio), minWindowCount: Number(minWindow), minBaselineEvents: Number(minBaseline), absoluteFloor: Number(floor) },
      cooldownMinutes: Number(cooldown),
      webhook: { enabled: webhookOn, ...(webhookUrl.trim() ? { url: webhookUrl.trim() } : {}), ...(webhookSecret ? { secret: webhookSecret } : {}) },
      slack: { enabled: slackOn, ...(slackUrl.trim() ? { url: slackUrl.trim() } : {}) },
    };
    void send(body);
  };

  const number = (label: string, value: string, set: (v: string) => void, id: string) => (
    <div>
      <label htmlFor={id} className="block text-xs mb-1" style={{ color: 'var(--color-text-secondary)' }}>
        {label}
      </label>
      <input id={id} type="number" value={value} onChange={(e) => set(e.target.value)} className="border px-3 py-2 text-sm w-40" style={inputStyle} />
    </div>
  );

  return (
    <div className="space-y-6">
      <Link href="/admin/hatalar" className="text-sm hover:underline" style={{ color: 'var(--color-text-secondary)' }}>
        {t('adminErrors.detail.back')}
      </Link>
      <div>
        <h2 className="text-xl font-bold">{t('adminErrors.settings.title')}</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          {t('adminErrors.settings.subtitle')}
        </p>
      </div>
      {!data.encryptionAvailable && (
        <p role="alert" className="text-sm" style={{ color: 'var(--color-danger)' }}>
          {t('adminErrors.settings.noEncryption')}
        </p>
      )}

      <section className="space-y-3 p-5 border" style={card}>
        <h3 className="text-sm font-semibold">{t('adminErrors.settings.spike.title')}</h3>
        <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          {t('adminErrors.settings.spike.help')}
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          {t('adminErrors.settings.spike.enabled')}
        </label>
        <div className="flex flex-wrap gap-4">
          {number(t('adminErrors.settings.spike.ratio'), ratio, setRatio, 'spike-ratio')}
          {number(t('adminErrors.settings.spike.minWindowCount'), minWindow, setMinWindow, 'spike-min-window')}
          {number(t('adminErrors.settings.spike.minBaselineEvents'), minBaseline, setMinBaseline, 'spike-min-baseline')}
          {number(t('adminErrors.settings.spike.absoluteFloor'), floor, setFloor, 'spike-floor')}
          {number(t('adminErrors.settings.cooldown'), cooldown, setCooldown, 'spike-cooldown')}
        </div>
      </section>

      <section className="space-y-3 p-5 border" style={card}>
        <h3 className="text-sm font-semibold">{t('adminErrors.settings.webhook.title')}</h3>
        <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          {data.webhook.configured
            ? t('adminErrors.settings.webhook.configured', { host: data.webhook.host ?? '-', last4: data.webhook.secretLast4 ?? '-' })
            : t('adminErrors.settings.webhook.notConfigured')}
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={webhookOn} onChange={(e) => setWebhookOn(e.target.checked)} />
          {t('adminErrors.settings.webhook.enabled')}
        </label>
        <input aria-label={t('adminErrors.settings.webhook.url')} placeholder={t('adminErrors.settings.webhook.url')} value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} autoComplete="off" className="border px-3 py-2 text-sm w-full" style={inputStyle} />
        <input aria-label={t('adminErrors.settings.webhook.secret')} placeholder={t('adminErrors.settings.webhook.secret')} type="password" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} autoComplete="off" className="border px-3 py-2 text-sm w-full" style={inputStyle} />
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {t('adminErrors.settings.keepHint')}
        </p>
        {data.webhook.configured && (
          <button type="button" disabled={busy} onClick={() => send({ webhook: { url: null, secret: null } })} className="px-3 py-1 text-xs font-medium border" style={secondary}>
            {t('adminErrors.settings.webhook.remove')}
          </button>
        )}
      </section>

      <section className="space-y-3 p-5 border" style={card}>
        <h3 className="text-sm font-semibold">{t('adminErrors.settings.slack.title')}</h3>
        <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          {data.slack.configured ? t('adminErrors.settings.slack.configured') : t('adminErrors.settings.slack.notConfigured')}
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={slackOn} onChange={(e) => setSlackOn(e.target.checked)} />
          {t('adminErrors.settings.slack.enabled')}
        </label>
        <input aria-label={t('adminErrors.settings.slack.url')} placeholder={t('adminErrors.settings.slack.url')} value={slackUrl} onChange={(e) => setSlackUrl(e.target.value)} autoComplete="off" className="border px-3 py-2 text-sm w-full" style={inputStyle} />
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {t('adminErrors.settings.keepHint')}
        </p>
        {data.slack.configured && (
          <button type="button" disabled={busy} onClick={() => send({ slack: { url: null } })} className="px-3 py-1 text-xs font-medium border" style={secondary}>
            {t('adminErrors.settings.slack.remove')}
          </button>
        )}
      </section>

      <div className="flex items-center gap-3">
        <button type="button" disabled={busy} onClick={save} className="px-4 py-2 text-sm font-medium" style={primary}>
          {t('adminErrors.settings.save')}
        </button>
        {message && (
          <p role="status" className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
