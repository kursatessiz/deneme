'use client';

import { useState } from 'react';
import { AD_CONNECTION_PLATFORMS, buildCampaignName, AD_URL_TEMPLATES, CAMPAIGN_OBJECTIVES } from '@platform/shared';
import type { AdConnectionPlatform, CampaignObjective } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { PageGuard } from '@/components/common/PageGuard';
import { Badge, InlineMessage, PrimaryButton, SecondaryButton, Section, SettingsHeader, TextField } from '@/components/settings/ui';

interface AdConnectionRow {
  id: string;
  platform: AdConnectionPlatform;
  label: string;
  status: 'DISCONNECTED' | 'CONNECTED' | 'ERROR';
  externalAccountId: string;
  isTestMode: boolean;
  credentialLast4: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
}

interface CredentialFields {
  META: { accessToken: string; pixelId: string };
  GOOGLE: { clientId: string; clientSecret: string; refreshToken: string; developerToken: string; loginCustomerId: string; customerId: string };
  TIKTOK: { accessToken: string; pixelCode: string };
}

const EMPTY_CREDENTIALS: CredentialFields = {
  META: { accessToken: '', pixelId: '' },
  GOOGLE: { clientId: '', clientSecret: '', refreshToken: '', developerToken: '', loginCustomerId: '', customerId: '' },
  TIKTOK: { accessToken: '', pixelCode: '' },
};

function CopyButton({ text, t }: { text: string; t: (k: string) => string }) {
  const [copied, setCopied] = useState(false);
  return (
    <SecondaryButton
      onClick={() => {
        navigator.clipboard?.writeText(text).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? t('ads.utm.copied') : t('ads.utm.copy')}
    </SecondaryButton>
  );
}

function ConnectionsSection() {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const [refreshKey, setRefreshKey] = useState(0);
  // refreshKey is folded into the path (not just used as a React key) so
  // useBff's own effect, which only reruns when `path` or `studioId`
  // changes, actually refetches after a create/delete/test action.
  const path = activeStudioId ? `studios/${activeStudioId}/ads/connections${refreshKey ? `?_r=${refreshKey}` : ''}` : null;
  const { data, loading, error } = useBff<AdConnectionRow[]>(path, activeStudioId);
  const [platform, setPlatform] = useState<AdConnectionPlatform>('META');
  const [label, setLabel] = useState('');
  const [externalAccountId, setExternalAccountId] = useState('');
  const [credentials, setCredentials] = useState<CredentialFields>(EMPTY_CREDENTIALS);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  const setField = (platformKey: AdConnectionPlatform, field: string, value: string) => {
    setCredentials((prev) => ({ ...prev, [platformKey]: { ...prev[platformKey], [field]: value } }));
  };

  const create = async () => {
    setFormError(null);
    if (label.trim().length < 1 || externalAccountId.trim().length < 1) {
      setFormError(t('ads.connections.saveError'));
      return;
    }
    setCreating(true);
    try {
      await bffFetch(`studios/${activeStudioId}/ads/connections`, {
        method: 'POST',
        body: { platform, label, externalAccountId, credentials: credentials[platform], isTestMode: false },
        studioId: activeStudioId,
      });
      setLabel('');
      setExternalAccountId('');
      setCredentials(EMPTY_CREDENTIALS);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setFormError(err instanceof BffError ? err.message : t('ads.connections.saveError'));
    } finally {
      setCreating(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm(t('ads.connections.deleteConfirm'))) return;
    setActionError(null);
    try {
      await bffFetch(`studios/${activeStudioId}/ads/connections/${id}`, { method: 'DELETE', studioId: activeStudioId });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setActionError(err instanceof BffError ? err.message : t('ads.connections.saveError'));
    }
  };

  const test = async (id: string) => {
    setActionError(null);
    try {
      const res = await bffFetch<{ ok: boolean; message: string }>(`studios/${activeStudioId}/ads/connections/${id}/test`, {
        method: 'POST',
        studioId: activeStudioId,
      });
      setTestResult((prev) => ({ ...prev, [id]: res.ok ? t('ads.connections.testConnection.ok') : res.message }));
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setTestResult((prev) => ({ ...prev, [id]: err instanceof BffError ? err.message : t('ads.connections.testConnection.fail') }));
    }
  };

  return (
    <Section title={t('ads.connections.title')} description={t('ads.connections.description')} key={refreshKey}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl items-end">
        <div>
          <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            {t('ads.connections.platform')}
          </span>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as AdConnectionPlatform)}
            className="w-full mt-1 px-3 py-2 text-sm border"
            style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-input)', backgroundColor: 'var(--color-background)', color: 'var(--color-text-primary)' }}
          >
            {AD_CONNECTION_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {t(`ads.connections.platform.${p}` as never)}
              </option>
            ))}
          </select>
        </div>
        <TextField label={t('ads.connections.label')} value={label} onChange={setLabel} />
        <TextField label={t('ads.connections.externalAccountId')} value={externalAccountId} onChange={setExternalAccountId} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
        {platform === 'META' && (
          <>
            <TextField label="Access token" value={credentials.META.accessToken} onChange={(v) => setField('META', 'accessToken', v)} type="password" />
            <TextField label="Pixel ID" value={credentials.META.pixelId} onChange={(v) => setField('META', 'pixelId', v)} />
          </>
        )}
        {platform === 'GOOGLE' && (
          <>
            <TextField label="Client ID" value={credentials.GOOGLE.clientId} onChange={(v) => setField('GOOGLE', 'clientId', v)} />
            <TextField label="Client secret" value={credentials.GOOGLE.clientSecret} onChange={(v) => setField('GOOGLE', 'clientSecret', v)} type="password" />
            <TextField label="Refresh token" value={credentials.GOOGLE.refreshToken} onChange={(v) => setField('GOOGLE', 'refreshToken', v)} type="password" />
            <TextField label="Developer token" value={credentials.GOOGLE.developerToken} onChange={(v) => setField('GOOGLE', 'developerToken', v)} type="password" />
            <TextField label="Login customer ID" value={credentials.GOOGLE.loginCustomerId} onChange={(v) => setField('GOOGLE', 'loginCustomerId', v)} />
            <TextField label="Customer ID" value={credentials.GOOGLE.customerId} onChange={(v) => setField('GOOGLE', 'customerId', v)} />
          </>
        )}
        {platform === 'TIKTOK' && (
          <>
            <TextField label="Access token" value={credentials.TIKTOK.accessToken} onChange={(v) => setField('TIKTOK', 'accessToken', v)} type="password" />
            <TextField label="Pixel code" value={credentials.TIKTOK.pixelCode} onChange={(v) => setField('TIKTOK', 'pixelCode', v)} />
          </>
        )}
      </div>
      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        {t('ads.connections.credentialHint')}
      </p>
      {formError && <InlineMessage text={formError} tone="error" />}
      <PrimaryButton onClick={create} disabled={creating}>
        {creating ? '...' : t('ads.connections.add')}
      </PrimaryButton>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {actionError && <InlineMessage text={actionError} tone="error" />}
      {!loading && !error && (!data || data.length === 0) && <EmptyState title={t('ads.report.empty')} />}
      {!loading && !error && data && data.length > 0 && (
        <div className="space-y-2">
          {data.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-3 py-2 border-b last:border-b-0" style={{ borderColor: 'var(--color-border)' }}>
              <div className="min-w-0">
                <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                  {c.label} <span style={{ color: 'var(--color-text-muted)' }}>({t(`ads.connections.platform.${c.platform}` as never)})</span>
                </p>
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {t('ads.connections.credentialHint').split(',')[0]}: ****{c.credentialLast4}
                  {c.lastSyncAt && ` — ${t('ads.connections.lastSync')}: ${new Date(c.lastSyncAt).toLocaleString()}`}
                </p>
                {testResult[c.id] && (
                  <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    {testResult[c.id]}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge tone={c.status === 'CONNECTED' ? 'primary' : c.status === 'ERROR' ? 'danger' : 'neutral'}>
                  {t(`ads.connections.status.${c.status}` as never)}
                </Badge>
                <SecondaryButton onClick={() => test(c.id)}>{t('ads.connections.testConnection')}</SecondaryButton>
                <SecondaryButton danger onClick={() => remove(c.id)}>
                  {t('ads.connections.delete')}
                </SecondaryButton>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function UtmBuilderSection() {
  const t = useT();
  const [market, setMarket] = useState('tr');
  const [language, setLanguage] = useState('tr');
  const [sector, setSector] = useState('pilates');
  const [objective, setObjective] = useState<CampaignObjective>('lead');
  const [yearMonth, setYearMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [platform, setPlatform] = useState<'META' | 'GOOGLE' | 'TIKTOK'>('META');
  const [landingPath, setLandingPath] = useState('');

  let campaignName = '';
  let buildError: string | null = null;
  try {
    campaignName = buildCampaignName({ market, language, sector, objective, yearMonth });
  } catch (err) {
    buildError = err instanceof Error ? err.message : 'Geçersiz';
  }
  const urlParams = AD_URL_TEMPLATES[platform];
  const exampleUrl = landingPath ? `https://example.com/${landingPath.replace(/^\/+/, '')}?${urlParams}` : '';

  return (
    <Section title={t('ads.utm.title')} description={t('ads.utm.description')}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl">
        <TextField label={t('ads.utm.market')} value={market} onChange={setMarket} />
        <TextField label={t('ads.utm.language')} value={language} onChange={setLanguage} />
        <TextField label={t('ads.utm.sector')} value={sector} onChange={setSector} />
        <div>
          <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            {t('ads.utm.objective')}
          </span>
          <select
            value={objective}
            onChange={(e) => setObjective(e.target.value as CampaignObjective)}
            className="w-full mt-1 px-3 py-2 text-sm border"
            style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-input)', backgroundColor: 'var(--color-background)', color: 'var(--color-text-primary)' }}
          >
            {CAMPAIGN_OBJECTIVES.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
        <TextField label={t('ads.utm.month')} value={yearMonth} onChange={setYearMonth} placeholder="202610" />
        <div>
          <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            {t('ads.utm.platform')}
          </span>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as 'META' | 'GOOGLE' | 'TIKTOK')}
            className="w-full mt-1 px-3 py-2 text-sm border"
            style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-input)', backgroundColor: 'var(--color-background)', color: 'var(--color-text-primary)' }}
          >
            <option value="META">Meta</option>
            <option value="GOOGLE">Google</option>
            <option value="TIKTOK">TikTok</option>
          </select>
        </div>
      </div>
      <TextField label={t('ads.utm.landingPath')} value={landingPath} onChange={setLandingPath} placeholder="tr/pilates" />

      {buildError && <InlineMessage text={buildError} tone="error" />}
      {!buildError && (
        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              {t('ads.utm.campaignName')}
            </p>
            <div className="flex items-center gap-2">
              <code className="text-sm" style={{ color: 'var(--color-text-primary)' }}>
                {campaignName}
              </code>
              <CopyButton text={campaignName} t={t} />
            </div>
          </div>
          <div>
            <p className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              {t('ads.utm.urlParams')}
            </p>
            <div className="flex items-center gap-2">
              <code className="text-xs break-all" style={{ color: 'var(--color-text-primary)' }}>
                {urlParams}
              </code>
              <CopyButton text={urlParams} t={t} />
            </div>
          </div>
          {exampleUrl && (
            <div>
              <p className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                {t('ads.utm.exampleUrl')}
              </p>
              <div className="flex items-center gap-2">
                <code className="text-xs break-all" style={{ color: 'var(--color-text-primary)' }}>
                  {exampleUrl}
                </code>
                <CopyButton text={exampleUrl} t={t} />
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                {t('ads.utm.landingUnknown')}
              </p>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function NamingCheckSection() {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const { data, loading, error } = useBff<Array<{ externalId: string; name: string; platform: string }>>(
    activeStudioId ? `studios/${activeStudioId}/ads/naming-check` : null,
    activeStudioId,
  );
  return (
    <Section title={t('ads.utm.namingCheck.title')} description={t('ads.utm.namingCheck.description')}>
      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!data || data.length === 0) && <EmptyState title={t('ads.utm.namingCheck.empty')} />}
      {!loading && !error && data && data.length > 0 && (
        <ul className="space-y-1">
          {data.map((row) => (
            <li key={row.externalId} className="text-sm" style={{ color: 'var(--color-text-primary)' }}>
              {row.name} <span style={{ color: 'var(--color-text-muted)' }}>({row.platform})</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function AdsSettings() {
  const t = useT();
  return (
    <div className="space-y-6">
      <SettingsHeader title={t('ads.nav.settings')} description={t('ads.connections.description')} />
      <ConnectionsSection />
      <UtmBuilderSection />
      <NamingCheckSection />
    </div>
  );
}

export default function AdsSettingsPage() {
  return (
    <PageGuard required={['ads.manage']}>
      <AdsSettings />
    </PageGuard>
  );
}
