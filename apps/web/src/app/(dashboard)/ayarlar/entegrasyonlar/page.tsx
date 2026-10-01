'use client';

import { useState } from 'react';
import { ALL_API_KEY_SCOPES, API_KEY_SCOPES, PARTNER_PROVIDERS, TENANT_WEBHOOK_EVENTS, WEBHOOK_EVENTS } from '@platform/shared';
import type { ApiKeyScope, PartnerConnectionStatusName, PartnerProviderName, WebhookEvent } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { PageGuard } from '@/components/common/PageGuard';
import { hasAnyPermission } from '@/lib/nav';
import { Badge, InlineMessage, PrimaryButton, SecondaryButton, Section, SettingsHeader, TextField } from '@/components/settings/ui';
import { validateWebhookUrl } from '@/lib/settings/url-validation';
import { Checkbox } from '@/components/ui/Checkbox';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { FieldGroup } from '@/components/ui/FieldGroup';
import { List, ListItem } from '@/components/ui/List';

interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

interface WebhookRow {
  id: string;
  url: string;
  events: WebhookEvent[];
  isActive: boolean;
  failureCount: number;
  createdAt: string;
}

interface WebhookDelivery {
  id: string;
  event: string;
  status: string;
  createdAt: string;
  lastError: string | null;
}

interface PartnerConnectionRow {
  id: string;
  provider: PartnerProviderName;
  label: string;
  status: PartnerConnectionStatusName;
  hasCredentials: boolean;
  lastSyncAt: string | null;
  consecutiveFailures: number;
}

function CopyButton({ text }: { text: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <SecondaryButton
      onClick={() => {
        navigator.clipboard?.writeText(text).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? t('settings.integrations.copied') : t('settings.integrations.copy')}
    </SecondaryButton>
  );
}

function ApiKeysSection() {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const { data, loading, error } = useBff<ApiKeyRow[]>('integrations/api-keys', activeStudioId);
  const [refreshKey, setRefreshKey] = useState(0);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Set<ApiKeyScope>>(new Set());
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const toggleScope = (s: ApiKeyScope) => {
    setScopes((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const create = async () => {
    setCreateError(null);
    if (name.trim().length < 2) {
      setCreateError(t('settings.integrations.apiKeys.nameTooShort'));
      return;
    }
    if (scopes.size === 0) {
      setCreateError(t('settings.integrations.apiKeys.scopeRequired'));
      return;
    }
    setCreating(true);
    try {
      const res = await bffFetch<{ plaintext: string }>('integrations/api-keys', {
        method: 'POST',
        body: { name, scopes: [...scopes] },
        studioId: activeStudioId,
      });
      setPlaintext(res.plaintext);
      setName('');
      setScopes(new Set());
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setCreateError(err instanceof BffError ? err.message : t('settings.integrations.apiKeys.errors.createFailed'));
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    setActionError(null);
    try {
      await bffFetch(`integrations/api-keys/${id}`, { method: 'DELETE', studioId: activeStudioId });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setActionError(err instanceof BffError ? err.message : t('settings.integrations.apiKeys.errors.revokeFailed'));
    }
  };

  return (
    <Section title={t('settings.integrations.apiKeys.title')} description={t('settings.integrations.apiKeys.description')} key={refreshKey}>
      {plaintext && (
        <div className="ui-panel grid gap-2 p-3">
          <p className="ui-caption ui-strong">{t('settings.integrations.apiKeys.showOnce')}</p>
          <div className="flex items-center gap-2">
            <code className="ui-caption break-all flex-1">{plaintext}</code>
            <CopyButton text={plaintext} />
          </div>
          <Button variant="link" size="sm" className="justify-self-start" onClick={() => setPlaintext(null)}>
            {t('settings.integrations.close')}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end max-w-xl">
        <TextField
          label={t('settings.integrations.apiKeys.nameLabel')}
          value={name}
          onChange={setName}
          placeholder={t('settings.integrations.apiKeys.namePlaceholder')}
        />
        <PrimaryButton onClick={create} disabled={creating}>
          {creating ? t('settings.integrations.apiKeys.creating') : t('settings.integrations.apiKeys.create')}
        </PrimaryButton>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {ALL_API_KEY_SCOPES.map((s) => (
          <Checkbox key={s} label={API_KEY_SCOPES[s]} checked={scopes.has(s)} onChange={() => toggleScope(s)} />
        ))}
      </div>
      {createError && <InlineMessage text={createError} tone="error" />}

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {actionError && <InlineMessage text={actionError} tone="error" />}
      {!loading && !error && (!data || data.length === 0) && <EmptyState title={t('settings.integrations.apiKeys.empty')} />}
      {!loading && !error && data && data.length > 0 && (
        <List className="ui-divide">
          {data.map((k) => (
            <ListItem key={k.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="ui-strong">
                  {k.name} <span className="ui-text-muted">({k.prefix}...)</span>
                </p>
                <p className="ui-caption">{k.scopes.join(', ')}</p>
              </div>
              {k.revokedAt ? (
                <Badge tone="danger">{t('settings.integrations.apiKeys.revoked')}</Badge>
              ) : (
                <SecondaryButton danger onClick={() => revoke(k.id)}>
                  {t('settings.integrations.apiKeys.revoke')}
                </SecondaryButton>
              )}
            </ListItem>
          ))}
        </List>
      )}
    </Section>
  );
}

function WebhookDeliveries({ endpointId }: { endpointId: string }) {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const { data, loading, error } = useBff<{ items: WebhookDelivery[] }>(`integrations/webhooks/${endpointId}/deliveries`, activeStudioId);
  const [actionError, setActionError] = useState<string | null>(null);
  const [redelivering, setRedelivering] = useState<string | null>(null);

  const redeliver = async (deliveryId: string) => {
    setActionError(null);
    setRedelivering(deliveryId);
    try {
      await bffFetch(`integrations/webhooks/${endpointId}/deliveries/${deliveryId}/redeliver`, { method: 'POST', studioId: activeStudioId });
    } catch (err) {
      setActionError(err instanceof BffError ? err.message : t('settings.integrations.webhooks.deliveries.errors.redeliverFailed'));
    } finally {
      setRedelivering(null);
    }
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!data || data.items.length === 0) return <EmptyState title={t('settings.integrations.webhooks.deliveries.empty')} />;

  return (
    <List>
      {actionError && <InlineMessage text={actionError} tone="error" />}
      {data.items.map((d) => (
        <ListItem key={d.id} className="flex items-center justify-between ui-caption">
          <span>
            {d.event} -- {d.status}
            {d.lastError ? ` -- ${d.lastError}` : ''}
          </span>
          <Button variant="link" size="sm" disabled={redelivering === d.id} onClick={() => redeliver(d.id)}>
            {t('settings.integrations.webhooks.deliveries.resend')}
          </Button>
        </ListItem>
      ))}
    </List>
  );
}

function WebhooksSection() {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const { data, loading, error } = useBff<WebhookRow[]>('integrations/webhooks', activeStudioId);
  const [refreshKey, setRefreshKey] = useState(0);
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [events, setEvents] = useState<Set<WebhookEvent>>(new Set());
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [secretShown, setSecretShown] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const toggleEvent = (e: WebhookEvent) => {
    setEvents((prev) => {
      const next = new Set(prev);
      if (next.has(e)) next.delete(e);
      else next.add(e);
      return next;
    });
  };

  const create = async () => {
    setCreateError(null);
    setUrlError(null);
    const check = validateWebhookUrl(url, { invalidAddress: t('common.invalidAddress') });
    if (!check.valid) {
      setUrlError(check.error);
      return;
    }
    if (events.size === 0) {
      setCreateError(t('settings.integrations.webhooks.eventRequired'));
      return;
    }
    setCreating(true);
    try {
      const res = await bffFetch<{ secret: string }>('integrations/webhooks', {
        method: 'POST',
        body: { url, events: [...events], isActive: true },
        studioId: activeStudioId,
      });
      setSecretShown(res.secret);
      setUrl('');
      setEvents(new Set());
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setCreateError(err instanceof BffError ? err.message : t('settings.integrations.webhooks.errors.createFailed'));
    } finally {
      setCreating(false);
    }
  };

  const rotate = async (id: string) => {
    setActionError(null);
    try {
      const res = await bffFetch<{ secret: string }>(`integrations/webhooks/${id}/rotate-secret`, { method: 'POST', studioId: activeStudioId });
      setSecretShown(res.secret);
    } catch (err) {
      setActionError(err instanceof BffError ? err.message : t('settings.integrations.webhooks.errors.rotateFailed'));
    }
  };

  const remove = async (id: string) => {
    setActionError(null);
    try {
      await bffFetch(`integrations/webhooks/${id}`, { method: 'DELETE', studioId: activeStudioId });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setActionError(err instanceof BffError ? err.message : t('settings.integrations.webhooks.errors.deleteFailed'));
    }
  };

  const sendTest = async (id: string, event: WebhookEvent) => {
    setActionError(null);
    try {
      await bffFetch(`integrations/webhooks/${id}/test-event`, { method: 'POST', body: { event }, studioId: activeStudioId });
    } catch (err) {
      setActionError(err instanceof BffError ? err.message : t('settings.integrations.webhooks.errors.testFailed'));
    }
  };

  return (
    <Section title={t('settings.integrations.webhooks.title')} description={t('settings.integrations.webhooks.description')} key={refreshKey}>
      {secretShown && (
        <div className="ui-panel grid gap-2 p-3">
          <p className="ui-caption ui-strong">{t('settings.integrations.webhooks.secretShowOnce')}</p>
          <div className="flex items-center gap-2">
            <code className="ui-caption break-all flex-1">{secretShown}</code>
            <CopyButton text={secretShown} />
          </div>
          <Button variant="link" size="sm" className="justify-self-start" onClick={() => setSecretShown(null)}>
            {t('settings.integrations.close')}
          </Button>
        </div>
      )}

      <div className="max-w-xl space-y-2">
        <TextField label={t('settings.integrations.webhooks.urlLabel')} value={url} onChange={setUrl} placeholder="https://..." error={urlError} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {TENANT_WEBHOOK_EVENTS.map((e) => (
            <Checkbox key={e} label={WEBHOOK_EVENTS[e]} checked={events.has(e)} onChange={() => toggleEvent(e)} />
          ))}
        </div>
        {createError && <InlineMessage text={createError} tone="error" />}
        <PrimaryButton onClick={create} disabled={creating}>
          {creating ? t('settings.integrations.apiKeys.creating') : t('settings.integrations.webhooks.add')}
        </PrimaryButton>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {actionError && <InlineMessage text={actionError} tone="error" />}
      {!loading && !error && (!data || data.length === 0) && <EmptyState title={t('settings.integrations.webhooks.empty')} />}
      {!loading && !error && data && data.length > 0 && (
        <List className="ui-divide">
          {data.map((w) => (
            <ListItem key={w.id}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="ui-strong truncate">{w.url}</p>
                  <p className="ui-caption">
                    {w.events.join(', ')} {!w.isActive && `-- ${t('settings.integrations.webhooks.inactive')}`}{' '}
                    {w.failureCount > 0 && `-- ${t('settings.integrations.webhooks.consecutiveFailures', { count: w.failureCount })}`}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <SecondaryButton onClick={() => rotate(w.id)}>{t('settings.integrations.webhooks.rotateSecret')}</SecondaryButton>
                  <SecondaryButton onClick={() => sendTest(w.id, w.events[0])}>{t('settings.integrations.webhooks.testEvent')}</SecondaryButton>
                  <SecondaryButton onClick={() => setExpandedId(expandedId === w.id ? null : w.id)}>
                    {t('settings.integrations.webhooks.deliveries')}
                  </SecondaryButton>
                  <SecondaryButton danger onClick={() => remove(w.id)}>
                    {t('settings.integrations.webhooks.delete')}
                  </SecondaryButton>
                </div>
              </div>
              {expandedId === w.id && <WebhookDeliveries endpointId={w.id} />}
            </ListItem>
          ))}
        </List>
      )}
    </Section>
  );
}

function PartnersSection() {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const { data, loading, error } = useBff<PartnerConnectionRow[]>('partners/connections', activeStudioId);
  const [refreshKey, setRefreshKey] = useState(0);
  const [label, setLabel] = useState('');
  const [provider, setProvider] = useState<PartnerProviderName>('MOCK');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const statusLabel = (s: PartnerConnectionStatusName) =>
    s === 'ACTIVE'
      ? t('settings.integrations.partners.status.ACTIVE')
      : s === 'PAUSED'
        ? t('settings.integrations.partners.status.PAUSED')
        : t('settings.integrations.partners.status.INACTIVE');

  const create = async () => {
    setCreateError(null);
    if (label.trim().length < 1) {
      setCreateError(t('settings.integrations.partners.labelRequired'));
      return;
    }
    if (webhookSecret.trim().length < 1) {
      setCreateError(t('settings.integrations.partners.secretRequired'));
      return;
    }
    setCreating(true);
    try {
      await bffFetch('partners/connections', { method: 'POST', body: { provider, label, credentials: { webhookSecret } }, studioId: activeStudioId });
      setLabel('');
      setWebhookSecret('');
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setCreateError(err instanceof BffError ? err.message : t('settings.integrations.partners.errors.createFailed'));
    } finally {
      setCreating(false);
    }
  };

  const setStatus = async (id: string, status: PartnerConnectionStatusName) => {
    setActionError(null);
    try {
      await bffFetch(`partners/connections/${id}`, { method: 'PATCH', body: { status }, studioId: activeStudioId });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setActionError(err instanceof BffError ? err.message : t('settings.integrations.partners.errors.statusChangeFailed'));
    }
  };

  return (
    <Section title={t('settings.integrations.partners.title')} description={t('settings.integrations.partners.description')} key={refreshKey}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl items-end">
        <FieldGroup label={t('settings.integrations.partners.providerLabel')}>
          <Select value={provider} onChange={(e) => setProvider(e.target.value as PartnerProviderName)}>
            {PARTNER_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </FieldGroup>
        <TextField
          label={t('settings.integrations.partners.labelLabel')}
          value={label}
          onChange={setLabel}
          placeholder={t('settings.integrations.partners.labelPlaceholder')}
        />
        <TextField label={t('settings.integrations.partners.webhookSecretLabel')} value={webhookSecret} onChange={setWebhookSecret} type="password" />
      </div>
      {createError && <InlineMessage text={createError} tone="error" />}
      <PrimaryButton onClick={create} disabled={creating}>
        {creating ? t('settings.integrations.apiKeys.creating') : t('settings.integrations.partners.add')}
      </PrimaryButton>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {actionError && <InlineMessage text={actionError} tone="error" />}
      {!loading && !error && (!data || data.length === 0) && <EmptyState title={t('settings.integrations.partners.empty')} />}
      {!loading && !error && data && data.length > 0 && (
        <List className="ui-divide">
          {data.map((c) => (
            <ListItem key={c.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="ui-strong">
                  {c.label} <span className="ui-text-muted">({c.provider})</span>
                </p>
                <p className="ui-caption">
                  {statusLabel(c.status)}
                  {c.consecutiveFailures > 0 && ` -- ${t('settings.integrations.webhooks.consecutiveFailures', { count: c.consecutiveFailures })}`}
                </p>
              </div>
              {c.status === 'ACTIVE' ? (
                <SecondaryButton onClick={() => setStatus(c.id, 'PAUSED')}>{t('settings.integrations.partners.pause')}</SecondaryButton>
              ) : (
                <SecondaryButton onClick={() => setStatus(c.id, 'ACTIVE')}>{t('settings.integrations.partners.activate')}</SecondaryButton>
              )}
            </ListItem>
          ))}
        </List>
      )}
    </Section>
  );
}

function IntegrationsSettings() {
  const t = useT();
  const { permissions, isOwner } = useDashboardSession();
  const canIntegrations = hasAnyPermission(['integrations.manage'], permissions, isOwner);
  const canPartners = hasAnyPermission(['integrations.partners.manage'], permissions, isOwner);

  return (
    <div className="grid gap-6">
      <SettingsHeader title={t('settings.integrations.title')} description={t('settings.integrations.description')} />
      {canIntegrations && <ApiKeysSection />}
      {canIntegrations && <WebhooksSection />}
      {canPartners && <PartnersSection />}
    </div>
  );
}

export default function IntegrationsSettingsPage() {
  return (
    <PageGuard required={['integrations.manage', 'integrations.partners.manage']}>
      <IntegrationsSettings />
    </PageGuard>
  );
}
