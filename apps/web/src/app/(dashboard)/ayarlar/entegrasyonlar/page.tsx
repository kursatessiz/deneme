'use client';

import { useState } from 'react';
import { ALL_API_KEY_SCOPES, ALL_WEBHOOK_EVENTS, API_KEY_SCOPES, PARTNER_PROVIDERS, WEBHOOK_EVENTS } from '@platform/shared';
import type { ApiKeyScope, PartnerConnectionStatusName, PartnerProviderName, WebhookEvent } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { PageGuard } from '@/components/common/PageGuard';
import { hasAnyPermission } from '@/lib/nav';
import { Badge, InlineMessage, PrimaryButton, SecondaryButton, Section, SettingsHeader, TextField } from '@/components/settings/ui';
import { validateWebhookUrl } from '@/lib/settings/url-validation';

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
  const [copied, setCopied] = useState(false);
  return (
    <SecondaryButton
      onClick={() => {
        navigator.clipboard?.writeText(text).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? 'Kopyalandı' : 'Kopyala'}
    </SecondaryButton>
  );
}

function ApiKeysSection() {
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
      setCreateError('Anahtar adı en az 2 karakter olmalıdır');
      return;
    }
    if (scopes.size === 0) {
      setCreateError('En az bir yetki alanı seçilmelidir');
      return;
    }
    setCreating(true);
    try {
      const res = await bffFetch<{ plaintext: string }>('integrations/api-keys', { method: 'POST', body: { name, scopes: [...scopes] }, studioId: activeStudioId });
      setPlaintext(res.plaintext);
      setName('');
      setScopes(new Set());
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setCreateError(err instanceof BffError ? err.message : 'Anahtar oluşturulamadı');
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
      setActionError(err instanceof BffError ? err.message : 'Anahtar iptal edilemedi');
    }
  };

  return (
    <Section title="API anahtarları" description="Herkese açık REST API için kimlik doğrulama anahtarları" key={refreshKey}>
      {plaintext && (
        <div className="p-3 border space-y-2" style={{ borderColor: 'var(--color-primary)', borderRadius: 'var(--radius-input)' }}>
          <p className="text-xs font-medium" style={{ color: 'var(--color-text-primary)' }}>
            Bu anahtar yalnızca bir kez gösterilir, şimdi kopyalayın:
          </p>
          <div className="flex items-center gap-2">
            <code className="text-xs break-all flex-1" style={{ color: 'var(--color-text-primary)' }}>
              {plaintext}
            </code>
            <CopyButton text={plaintext} />
          </div>
          <button type="button" className="text-xs underline" onClick={() => setPlaintext(null)}>
            Kapat
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end max-w-xl">
        <TextField label="Anahtar adı" value={name} onChange={setName} placeholder="Örn. Rezervasyon sitesi" />
        <PrimaryButton onClick={create} disabled={creating}>
          {creating ? 'Oluşturuluyor...' : 'Anahtar oluştur'}
        </PrimaryButton>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {ALL_API_KEY_SCOPES.map((s) => (
          <label key={s} className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-primary)' }}>
            <input type="checkbox" checked={scopes.has(s)} onChange={() => toggleScope(s)} />
            {API_KEY_SCOPES[s]}
          </label>
        ))}
      </div>
      {createError && <InlineMessage text={createError} tone="error" />}

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {actionError && <InlineMessage text={actionError} tone="error" />}
      {!loading && !error && (!data || data.length === 0) && <EmptyState title="Henüz API anahtarı yok" />}
      {!loading && !error && data && data.length > 0 && (
        <div className="space-y-2">
          {data.map((k) => (
            <div key={k.id} className="flex items-center justify-between gap-3 py-2 border-b last:border-b-0" style={{ borderColor: 'var(--color-border)' }}>
              <div className="min-w-0">
                <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                  {k.name} <span style={{ color: 'var(--color-text-muted)' }}>({k.prefix}...)</span>
                </p>
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {k.scopes.join(', ')}
                </p>
              </div>
              {k.revokedAt ? <Badge tone="danger">İptal edildi</Badge> : <SecondaryButton danger onClick={() => revoke(k.id)}>İptal et</SecondaryButton>}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function WebhookDeliveries({ endpointId }: { endpointId: string }) {
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
      setActionError(err instanceof BffError ? err.message : 'Yeniden gönderilemedi');
    } finally {
      setRedelivering(null);
    }
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!data || data.items.length === 0) return <EmptyState title="Henüz teslimat yok" />;

  return (
    <div className="mt-2 space-y-1">
      {actionError && <InlineMessage text={actionError} tone="error" />}
      {data.items.map((d) => (
        <div key={d.id} className="flex items-center justify-between text-xs py-1" style={{ color: 'var(--color-text-secondary)' }}>
          <span>
            {d.event} -- {d.status}
            {d.lastError ? ` -- ${d.lastError}` : ''}
          </span>
          <button type="button" disabled={redelivering === d.id} className="underline disabled:opacity-50" onClick={() => redeliver(d.id)}>
            yeniden gönder
          </button>
        </div>
      ))}
    </div>
  );
}

function WebhooksSection() {
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
    const check = validateWebhookUrl(url);
    if (!check.valid) {
      setUrlError(check.error);
      return;
    }
    if (events.size === 0) {
      setCreateError('En az bir olay seçilmelidir');
      return;
    }
    setCreating(true);
    try {
      const res = await bffFetch<{ secret: string }>('integrations/webhooks', { method: 'POST', body: { url, events: [...events], isActive: true }, studioId: activeStudioId });
      setSecretShown(res.secret);
      setUrl('');
      setEvents(new Set());
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setCreateError(err instanceof BffError ? err.message : 'Webhook oluşturulamadı');
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
      setActionError(err instanceof BffError ? err.message : 'Gizli anahtar döndürülemedi');
    }
  };

  const remove = async (id: string) => {
    setActionError(null);
    try {
      await bffFetch(`integrations/webhooks/${id}`, { method: 'DELETE', studioId: activeStudioId });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setActionError(err instanceof BffError ? err.message : 'Webhook silinemedi');
    }
  };

  const sendTest = async (id: string, event: WebhookEvent) => {
    setActionError(null);
    try {
      await bffFetch(`integrations/webhooks/${id}/test-event`, { method: 'POST', body: { event }, studioId: activeStudioId });
    } catch (err) {
      setActionError(err instanceof BffError ? err.message : 'Test olayı gönderilemedi');
    }
  };

  return (
    <Section title="Webhook uç noktaları" description="Rezervasyon, üye ve ödeme olaylarını dış sistemlere iletir" key={refreshKey}>
      {secretShown && (
        <div className="p-3 border space-y-2" style={{ borderColor: 'var(--color-primary)', borderRadius: 'var(--radius-input)' }}>
          <p className="text-xs font-medium" style={{ color: 'var(--color-text-primary)' }}>
            Gizli anahtar yalnızca bir kez gösterilir:
          </p>
          <div className="flex items-center gap-2">
            <code className="text-xs break-all flex-1" style={{ color: 'var(--color-text-primary)' }}>
              {secretShown}
            </code>
            <CopyButton text={secretShown} />
          </div>
          <button type="button" className="text-xs underline" onClick={() => setSecretShown(null)}>
            Kapat
          </button>
        </div>
      )}

      <div className="max-w-xl space-y-2">
        <TextField label="Webhook adresi" value={url} onChange={setUrl} placeholder="https://..." error={urlError} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {ALL_WEBHOOK_EVENTS.map((e) => (
            <label key={e} className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-primary)' }}>
              <input type="checkbox" checked={events.has(e)} onChange={() => toggleEvent(e)} />
              {WEBHOOK_EVENTS[e]}
            </label>
          ))}
        </div>
        {createError && <InlineMessage text={createError} tone="error" />}
        <PrimaryButton onClick={create} disabled={creating}>
          {creating ? 'Oluşturuluyor...' : 'Webhook ekle'}
        </PrimaryButton>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {actionError && <InlineMessage text={actionError} tone="error" />}
      {!loading && !error && (!data || data.length === 0) && <EmptyState title="Henüz webhook yok" />}
      {!loading && !error && data && data.length > 0 && (
        <div className="space-y-3">
          {data.map((w) => (
            <div key={w.id} className="border-b last:border-b-0 pb-3" style={{ borderColor: 'var(--color-border)' }}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>
                    {w.url}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {w.events.join(', ')} {!w.isActive && '-- pasif'} {w.failureCount > 0 && `-- ${w.failureCount} ardışık hata`}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <SecondaryButton onClick={() => rotate(w.id)}>Anahtarı döndür</SecondaryButton>
                  <SecondaryButton onClick={() => sendTest(w.id, w.events[0])}>Test olayı</SecondaryButton>
                  <SecondaryButton onClick={() => setExpandedId(expandedId === w.id ? null : w.id)}>Teslimatlar</SecondaryButton>
                  <SecondaryButton danger onClick={() => remove(w.id)}>Sil</SecondaryButton>
                </div>
              </div>
              {expandedId === w.id && <WebhookDeliveries endpointId={w.id} />}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function PartnersSection() {
  const { activeStudioId } = useDashboardSession();
  const { data, loading, error } = useBff<PartnerConnectionRow[]>('partners/connections', activeStudioId);
  const [refreshKey, setRefreshKey] = useState(0);
  const [label, setLabel] = useState('');
  const [provider, setProvider] = useState<PartnerProviderName>('MOCK');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const create = async () => {
    setCreateError(null);
    if (label.trim().length < 1) {
      setCreateError('Bağlantı etiketi giriniz');
      return;
    }
    if (webhookSecret.trim().length < 1) {
      setCreateError('Webhook gizli anahtarı giriniz');
      return;
    }
    setCreating(true);
    try {
      await bffFetch('partners/connections', { method: 'POST', body: { provider, label, credentials: { webhookSecret } }, studioId: activeStudioId });
      setLabel('');
      setWebhookSecret('');
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setCreateError(err instanceof BffError ? err.message : 'Bağlantı oluşturulamadı');
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
      setActionError(err instanceof BffError ? err.message : 'Durum değiştirilemedi');
    }
  };

  return (
    <Section title="Partner platformlar" description="Toplayıcı/pazaryeri bağlantıları; kimlik bilgileri yalnızca yazılır, hiçbir zaman görüntülenmez" key={refreshKey}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl items-end">
        <div>
          <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            Sağlayıcı
          </span>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as PartnerProviderName)}
            className="w-full mt-1 px-3 py-2 text-sm border"
            style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-input)', backgroundColor: 'var(--color-background)', color: 'var(--color-text-primary)' }}
          >
            {PARTNER_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <TextField label="Etiket" value={label} onChange={setLabel} placeholder="Örn. ClassPass Ana" />
        <TextField label="Webhook gizli anahtarı" value={webhookSecret} onChange={setWebhookSecret} type="password" />
      </div>
      {createError && <InlineMessage text={createError} tone="error" />}
      <PrimaryButton onClick={create} disabled={creating}>
        {creating ? 'Oluşturuluyor...' : 'Bağlantı ekle'}
      </PrimaryButton>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {actionError && <InlineMessage text={actionError} tone="error" />}
      {!loading && !error && (!data || data.length === 0) && <EmptyState title="Henüz partner bağlantısı yok" />}
      {!loading && !error && data && data.length > 0 && (
        <div className="space-y-2">
          {data.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-3 py-2 border-b last:border-b-0" style={{ borderColor: 'var(--color-border)' }}>
              <div className="min-w-0">
                <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                  {c.label} <span style={{ color: 'var(--color-text-muted)' }}>({c.provider})</span>
                </p>
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {c.status === 'ACTIVE' ? 'Etkin' : c.status === 'PAUSED' ? 'Duraklatıldı' : 'Pasif'}
                  {c.consecutiveFailures > 0 && ` -- ${c.consecutiveFailures} ardışık hata`}
                </p>
              </div>
              {c.status === 'ACTIVE' ? (
                <SecondaryButton onClick={() => setStatus(c.id, 'PAUSED')}>Duraklat</SecondaryButton>
              ) : (
                <SecondaryButton onClick={() => setStatus(c.id, 'ACTIVE')}>Etkinleştir</SecondaryButton>
              )}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function IntegrationsSettings() {
  const { permissions, isOwner } = useDashboardSession();
  const canIntegrations = hasAnyPermission(['integrations.manage'], permissions, isOwner);
  const canPartners = hasAnyPermission(['integrations.partners.manage'], permissions, isOwner);

  return (
    <div className="space-y-6">
      <SettingsHeader title="Entegrasyonlar" description="API anahtarları, webhook'lar ve partner platform bağlantıları" />
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
