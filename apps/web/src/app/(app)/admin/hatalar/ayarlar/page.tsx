'use client';

import { useEffect, useState } from 'react';
import type { ErrorSettingsDTO, ErrorSettingsUpdate } from '@platform/shared';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/DataState';
import { useT } from '@/components/i18n/I18nProvider';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { FieldGroup } from '@/components/ui/FieldGroup';
import { Input } from '@/components/ui/Input';
import { LinkButton } from '@/components/ui/LinkButton';
import { PageHeader } from '@/components/ui/PageHeader';


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
    <label htmlFor={id} className="pui-field-group">
      <span>{label}</span>
      <Input id={id} type="number" value={value} onChange={(e) => set(e.target.value)} className="w-40" />
    </label>
  );

  return (
    <div className="grid gap-6">
      <LinkButton href="/admin/hatalar" variant="link" tone="surface" size="sm" className="justify-self-start">
        {t('adminErrors.detail.back')}
      </LinkButton>
      <PageHeader title={t('adminErrors.settings.title')} description={t('adminErrors.settings.subtitle')} />
      {!data.encryptionAvailable && (
        <p role="alert" className="ui-text-error">
          {t('adminErrors.settings.noEncryption')}
        </p>
      )}

      <Card as="section">
        <CardContent>
          <h3 className="ui-heading">{t('adminErrors.settings.spike.title')}</h3>
          <p className="ui-caption">{t('adminErrors.settings.spike.help')}</p>
          <Checkbox label={t('adminErrors.settings.spike.enabled')} checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <div className="flex flex-wrap gap-4">
            {number(t('adminErrors.settings.spike.ratio'), ratio, setRatio, 'spike-ratio')}
            {number(t('adminErrors.settings.spike.minWindowCount'), minWindow, setMinWindow, 'spike-min-window')}
            {number(t('adminErrors.settings.spike.minBaselineEvents'), minBaseline, setMinBaseline, 'spike-min-baseline')}
            {number(t('adminErrors.settings.spike.absoluteFloor'), floor, setFloor, 'spike-floor')}
            {number(t('adminErrors.settings.cooldown'), cooldown, setCooldown, 'spike-cooldown')}
          </div>
        </CardContent>
      </Card>

      <Card as="section">
        <CardContent>
          <h3 className="ui-heading">{t('adminErrors.settings.webhook.title')}</h3>
          <p className="ui-caption">
            {data.webhook.configured
              ? t('adminErrors.settings.webhook.configured', { host: data.webhook.host ?? '-', last4: data.webhook.secretLast4 ?? '-' })
              : t('adminErrors.settings.webhook.notConfigured')}
          </p>
          <Checkbox label={t('adminErrors.settings.webhook.enabled')} checked={webhookOn} onChange={(e) => setWebhookOn(e.target.checked)} />
          <Input aria-label={t('adminErrors.settings.webhook.url')} placeholder={t('adminErrors.settings.webhook.url')} value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} autoComplete="off" />
          <Input aria-label={t('adminErrors.settings.webhook.secret')} placeholder={t('adminErrors.settings.webhook.secret')} type="password" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} autoComplete="off" />
          <p className="ui-caption">{t('adminErrors.settings.keepHint')}</p>
          {data.webhook.configured && (
            <Button variant="outline" tone="surface" size="sm" className="justify-self-start" disabled={busy} onClick={() => send({ webhook: { url: null, secret: null } })}>
              {t('adminErrors.settings.webhook.remove')}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card as="section">
        <CardContent>
          <h3 className="ui-heading">{t('adminErrors.settings.slack.title')}</h3>
          <p className="ui-caption">{data.slack.configured ? t('adminErrors.settings.slack.configured') : t('adminErrors.settings.slack.notConfigured')}</p>
          <Checkbox label={t('adminErrors.settings.slack.enabled')} checked={slackOn} onChange={(e) => setSlackOn(e.target.checked)} />
          <Input aria-label={t('adminErrors.settings.slack.url')} placeholder={t('adminErrors.settings.slack.url')} value={slackUrl} onChange={(e) => setSlackUrl(e.target.value)} autoComplete="off" />
          <p className="ui-caption">{t('adminErrors.settings.keepHint')}</p>
          {data.slack.configured && (
            <Button variant="outline" tone="surface" size="sm" className="justify-self-start" disabled={busy} onClick={() => send({ slack: { url: null } })}>
              {t('adminErrors.settings.slack.remove')}
            </Button>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button disabled={busy} onClick={save}>
          {t('adminErrors.settings.save')}
        </Button>
        {message && (
          <p role="status" className="ui-caption">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
