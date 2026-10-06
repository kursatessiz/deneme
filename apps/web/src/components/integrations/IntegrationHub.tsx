'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  INTEGRATION_ENTRY_HEADER,
  type DnsRecordStatus,
  type EmailSenderDomainDTO,
  type ApiKeyScope,
  type IntegrationEntryPoint,
  type IntegrationHubDTO,
  type MessageKey,
  SOCIAL_PROVIDERS,
  type SocialConnectionDTO,
  type SocialConnectionTestDTO,
  type SocialProvider,
  oauthProviderForAdPlatform,
  oauthProviderForSocial,
  type OAuthProvider,
  type SesProvisionProvider,
  type SesProvisionResultDTO,
} from '@platform/shared';
import { bffFetch, BffError } from '@/lib/session/client';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { Badge } from '@/components/common/Badge';
import { ErrorState, LoadingState } from '@/components/common/DataState';
import { SelectField } from '@/components/marketing/fields';
import { InlineMessage, PrimaryButton, SecondaryButton, Section, SettingsHeader, TextField, Toggle } from '@/components/settings/ui';
import { AutomationSection } from './AutomationSection';
import { HubTable as Table } from './HubTable';
import { LeadAdsSection } from './LeadAdsSection';
import { SmsSenderSection } from './SmsSenderSection';
import { ConnectionAuthBadges, OAuthSection, useOAuthStart } from './OAuthSection';
import { Tr, Td } from '@/components/ui';
import { useConfirm } from '@/components/ui';

const STATUS_TONE: Record<DnsRecordStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  PENDING: 'neutral',
  VALID: 'success',
  INVALID: 'danger',
  MISSING: 'warning',
};

const PLATFORM_CARD_LABEL: Record<string, MessageKey> = {
  ai: 'integrations.platform.ai',
  smsBalance: 'integrations.platform.smsBalance',
  payments: 'integrations.platform.payments',
};

const CHANNEL_LABEL: Record<string, MessageKey> = {
  EMAIL: 'integrations.messaging.EMAIL',
  SMS: 'integrations.messaging.SMS',
  WHATSAPP: 'integrations.messaging.WHATSAPP',
};

/**
 * Integrations hub (docs/PAZARLAMA_MODULU.md 5.1), one component for both
 * entry points: `/admin/entegrasyonlar` (entry "admin") and
 * `/pazarlama/entegrasyonlar` (entry "marketing"). Every call goes to the
 * same `/platform/integrations` endpoints; the entry point only decides
 * what the audit log records. No secret is ever displayed.
 */
export function IntegrationHub({ entry, adsSettingsHref }: { entry: IntegrationEntryPoint; adsSettingsHref: string }) {
  const t = useT();
  const { confirm } = useConfirm();
  const locale = useLocale();
  const [data, setData] = useState<IntegrationHubDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyScopes, setNewKeyScopes] = useState<ApiKeyScope[]>(['webhooks.manage']);
  const [newKeyPlaintext, setNewKeyPlaintext] = useState<string | null>(null);
  const [domain, setDomain] = useState('');
  const [mailFrom, setMailFrom] = useState('');
  const [dkim, setDkim] = useState('');
  const [socialProvider, setSocialProvider] = useState<SocialProvider>('META_PAGE');
  const [socialExternalId, setSocialExternalId] = useState('');
  const [socialName, setSocialName] = useState('');
  const [socialToken, setSocialToken] = useState('');
  const [socialHost, setSocialHost] = useState<'graph.facebook.com' | 'graph.instagram.com'>('graph.facebook.com');
  const [rotateId, setRotateId] = useState<string | null>(null);
  const [rotateToken, setRotateToken] = useState('');
  /** M5: the sender domain provisioned through SES in this session, and whether SES answered or the mock did. */
  const [provisioned, setProvisioned] = useState<{ id: string; provider: SesProvisionProvider } | null>(null);

  const startOAuth = useOAuthStart(entry);
  const headers = { [INTEGRATION_ENTRY_HEADER]: entry };
  const fmtDate = (iso: string | null) => (iso ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : t('integrations.ads.never'));

  const load = useCallback(() => {
    bffFetch<IntegrationHubDTO>('platform/integrations', { headers: { [INTEGRATION_ENTRY_HEADER]: entry } })
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch((err) => setError(err instanceof BffError ? err.message : t('integrations.loadFailed')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry]);

  useEffect(load, [load]);

  async function run(action: () => Promise<unknown>) {
    setMessage(null);
    try {
      await action();
      setMessage({ text: t('integrations.saved'), ok: true });
      load();
    } catch (err) {
      setMessage({ text: err instanceof BffError ? err.message : t('integrations.actionFailed'), ok: false });
    }
  }

  if (error) return <ErrorState message={error} />;
  if (!data) return <LoadingState />;

  const call = (path: string, method: string, body?: unknown) => bffFetch(`platform/integrations/${path}`, { method, body, headers });
  const oauthReady = (provider: OAuthProvider | null): provider is OAuthProvider => provider !== null && data.oauth.providers.some((p) => p.provider === provider && p.configured);

  return (
    <div className="space-y-6">
      <SettingsHeader title={t('integrations.title')} description={t('integrations.subtitle')} />
      {message && <InlineMessage text={message.text} tone={message.ok ? 'success' : 'error'} />}

      <OAuthSection data={data} entry={entry} run={run} fmtDate={fmtDate} />

      <Section title={t('integrations.ads.title')}>
        {data.adConnections.length === 0 ? (
          <p className="ui-text-muted">
            {t('integrations.ads.empty')}
          </p>
        ) : (
          <Table head={['', t('integrations.ads.credential'), t('integrations.ads.lastSync'), t('integrations.ads.lastError'), t('integrations.ads.testMode'), '']}>
            {data.adConnections.map((a) => (
              <Tr key={a.id}>
                <Td>
                  <span className="ui-strong">{a.platform}</span> <span className="ui-text-muted">{a.label}</span>
                  <span className="block">
                    <ConnectionAuthBadges auth={a} fmtDate={fmtDate} />
                  </span>
                </Td>
                <Td className="ui-mono ui-small">{a.credentialPreview}</Td>
                <Td className="ui-small">{fmtDate(a.lastSyncAt)}</Td>
                <Td className="ui-text-error ui-small">
                  {a.lastError ?? ''}
                </Td>
                <Td>
                  <Toggle label="" checked={a.isTestMode} onChange={(v) => run(() => call(`ads/${a.id}`, 'PATCH', { isTestMode: v }))} />
                </Td>
                <Td className="text-right space-x-2 whitespace-nowrap">
                  {oauthReady(oauthProviderForAdPlatform(a.platform)) && (
                    <SecondaryButton
                      onClick={() => {
                        const provider = oauthProviderForAdPlatform(a.platform);
                        if (provider) run(() => startOAuth(provider, { kind: 'RECONNECT_AD_CONNECTION', connectionId: a.id }));
                      }}
                    >
                      {t('integrationsOAuth.reconnect')}
                    </SecondaryButton>
                  )}
                  <SecondaryButton danger onClick={() => void confirm({ message: t('integrations.confirmDelete'), danger: true }).then((ok) => { if (ok) void run(() => call(`ads/${a.id}`, 'DELETE')); })}>
                    {t('integrations.delete')}
                  </SecondaryButton>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
        <Link href={adsSettingsHref} className="pui-link pui-surface ui-text-muted">
          {t('integrations.ads.manage')}
        </Link>
      </Section>

      <Section title={t('integrations.social.title')} description={t('integrations.social.description')}>
        {data.socialConnections.length === 0 ? (
          <p className="ui-text-muted">
            {t('integrations.social.empty')}
          </p>
        ) : (
          <Table head={[t('integrations.social.account'), t('integrations.social.credential'), t('integrations.social.status'), t('integrations.social.lastError'), '']}>
            {data.socialConnections.map((c: SocialConnectionDTO) => (
              <Tr key={c.id}>
                <Td>
                  <span className="ui-strong">{c.displayName}</span>
                  <span className="block ui-caption">
                    {t(`integrations.social.provider.${c.provider}`)}
                  </span>
                  <span className="block">
                    <ConnectionAuthBadges auth={c} fmtDate={fmtDate} />
                  </span>
                </Td>
                <Td className="ui-mono ui-small">{c.credentialPreview}</Td>
                <Td>
                  <Badge tone={c.status === 'CONNECTED' ? 'success' : 'danger'}>{t(`integrations.social.status.${c.status}`)}</Badge>
                </Td>
                <Td className="ui-text-error ui-small">
                  {c.lastError ?? ''}
                </Td>
                <Td className="text-right space-x-2 whitespace-nowrap">
                  <SecondaryButton
                    onClick={() =>
                      run(async () => {
                        const res = (await call(`social/${c.id}/test`, 'POST')) as SocialConnectionTestDTO;
                        if (!res.ok) throw new BffError(t('integrations.social.testFailed', { error: res.error ?? '' }), 422);
                      })
                    }
                  >
                    {t('integrations.social.test')}
                  </SecondaryButton>
                  {oauthReady(oauthProviderForSocial(c.provider)) && (
                    <SecondaryButton
                      onClick={() => {
                        const provider = oauthProviderForSocial(c.provider);
                        if (provider) run(() => startOAuth(provider, { kind: 'RECONNECT_SOCIAL_CONNECTION', connectionId: c.id }));
                      }}
                    >
                      {t('integrationsOAuth.reconnect')}
                    </SecondaryButton>
                  )}
                  <SecondaryButton onClick={() => setRotateId(rotateId === c.id ? null : c.id)}>{t('integrations.social.rotate')}</SecondaryButton>
                  <SecondaryButton danger onClick={() => void confirm({ message: t('integrations.confirmDelete'), danger: true }).then((ok) => { if (ok) void run(() => call(`social/${c.id}`, 'DELETE')); })}>
                    {t('integrations.delete')}
                  </SecondaryButton>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
        {rotateId && (
          <form
            className="flex flex-wrap gap-3 items-end"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await call(`social/${rotateId}`, 'PATCH', { credentials: { accessToken: rotateToken.trim() } });
                setRotateId(null);
                setRotateToken('');
              });
            }}
          >
            <TextField label={t('integrations.social.token')} value={rotateToken} onChange={setRotateToken} type="password" />
            <PrimaryButton type="submit" disabled={rotateToken.trim().length < 8}>
              {t('integrations.social.rotate')}
            </PrimaryButton>
          </form>
        )}
        <form
          className="grid gap-3 md:grid-cols-3 items-end"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await call('social', 'POST', {
                provider: socialProvider,
                externalId: socialExternalId.trim(),
                ...(socialName.trim() ? { displayName: socialName.trim() } : {}),
                credentials: { accessToken: socialToken.trim(), ...(socialProvider === 'INSTAGRAM' ? { apiHost: socialHost } : {}) },
              });
              setSocialExternalId('');
              setSocialName('');
              setSocialToken('');
            });
          }}
        >
          <SelectField
            label={t('integrations.social.provider')}
            value={socialProvider}
            onChange={(v) => setSocialProvider(v as SocialProvider)}
            options={SOCIAL_PROVIDERS.map((p) => ({ value: p, label: t(`integrations.social.provider.${p}`) }))}
          />
          <TextField label={t('integrations.social.externalId')} value={socialExternalId} onChange={setSocialExternalId} />
          <TextField label={t('integrations.social.displayName')} value={socialName} onChange={setSocialName} />
          <TextField label={t('integrations.social.token')} value={socialToken} onChange={setSocialToken} type="password" />
          {socialProvider === 'INSTAGRAM' && (
            <SelectField
              label={t('integrations.social.apiHost')}
              value={socialHost}
              onChange={(v) => setSocialHost(v === 'graph.instagram.com' ? 'graph.instagram.com' : 'graph.facebook.com')}
              options={[
                { value: 'graph.facebook.com', label: t('integrations.social.apiHost.graph.facebook.com') },
                { value: 'graph.instagram.com', label: t('integrations.social.apiHost.graph.instagram.com') },
              ]}
            />
          )}
          <div>
            <PrimaryButton type="submit" disabled={!socialExternalId.trim() || socialToken.trim().length < 8}>
              {t('integrations.social.add')}
            </PrimaryButton>
          </div>
        </form>
        <p className="ui-caption">
          {t('integrations.social.externalIdHint')}
        </p>
        <Link href="/pazarlama/sosyal" className="pui-link pui-surface ui-text-muted">
          {t('integrations.social.openPosts')}
        </Link>
      </Section>
      <LeadAdsSection data={data} run={run} call={call} fmtDate={fmtDate} entryHeaders={headers} showPlatformCards={entry === 'admin'} />

      <Section title={t('integrations.email.title')} description={t('integrations.email.description')}>
        {data.emailDomains.length === 0 && (
          <p className="ui-text-muted">
            {t('integrations.email.empty')}
          </p>
        )}
        {data.emailDomains.map((d) => (
          <EmailDomainCard
            key={d.id}
            domain={d}
            fmtDate={fmtDate}
            onCheck={() => run(() => call(`email-domains/${d.id}/check`, 'POST'))}
            onProvision={
              entry === 'admin'
                ? () =>
                    run(async () => {
                      const res = await bffFetch<SesProvisionResultDTO>(`admin/marketing/sender-domains/${d.id}/provision`, { method: 'POST', headers });
                      setProvisioned({ id: d.id, provider: res.provider });
                    })
                : undefined
            }
            provisioned={provisioned?.id === d.id ? provisioned.provider : null}
            onDelete={() => void confirm({ message: t('integrations.confirmDelete'), danger: true }).then((ok) => { if (ok) void run(() => call(`email-domains/${d.id}`, 'DELETE')); })}
          />
        ))}
        <form
          className="grid gap-3 md:grid-cols-3 items-end"
          onSubmit={(e) => {
            e.preventDefault();
            const tokens = dkim
              .split(/[\s,]+/)
              .map((v) => v.trim())
              .filter(Boolean);
            run(async () => {
              await call('email-domains', 'POST', { domain, mailFromDomain: mailFrom || undefined, dkimTokens: tokens });
              setDomain('');
              setMailFrom('');
              setDkim('');
            });
          }}
        >
          <TextField label={t('integrations.email.domain')} value={domain} onChange={setDomain} placeholder="news.example.com" />
          <TextField label={t('integrations.email.mailFrom')} value={mailFrom} onChange={setMailFrom} />
          <TextField label={t('integrations.email.dkimTokens')} value={dkim} onChange={setDkim} />
          <div>
            <PrimaryButton type="submit" disabled={!domain.trim()}>
              {t('integrations.email.add')}
            </PrimaryButton>
          </div>
        </form>
      </Section>

      <Section title={t('integrations.apiKeys.title')}>
        {newKeyPlaintext && (
          <div className="space-y-1">
            <p>{t('integrations.apiKeys.createdOnce')}</p>
            <code className="ui-panel block p-2 break-all ui-small ui-mono">
              {newKeyPlaintext}
            </code>
          </div>
        )}
        {data.apiKeys.length === 0 ? (
          <p className="ui-text-muted">
            {t('integrations.apiKeys.empty')}
          </p>
        ) : (
          <Table head={[t('integrations.apiKeys.name'), '', t('automationHub.scopes'), t('integrations.apiKeys.lastUsed'), '']}>
            {data.apiKeys.map((k) => (
              <Tr key={k.id}>
                <Td>{k.name}</Td>
                <Td className="ui-mono ui-small">{k.prefix}</Td>
                <Td className="ui-mono ui-small">{k.scopes.join(', ')}</Td>
                <Td className="ui-small">{fmtDate(k.lastUsedAt)}</Td>
                <Td className="text-right">
                  {k.revokedAt ? (
                    <Badge>{t('integrations.apiKeys.revoked')}</Badge>
                  ) : (
                    <SecondaryButton danger onClick={() => run(() => call(`api-keys/${k.id}`, 'DELETE'))}>
                      {t('integrations.apiKeys.revoke')}
                    </SecondaryButton>
                  )}
                </Td>
              </Tr>
            ))}
          </Table>
        )}
        <form
          className="flex flex-wrap gap-3 items-end"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const created = await bffFetch<{ plaintext: string }>('platform/integrations/api-keys', {
                method: 'POST',
                body: { name: newKeyName, scopes: newKeyScopes },
                headers,
              });
              setNewKeyPlaintext(created.plaintext);
              setNewKeyName('');
            });
          }}
        >
          <TextField label={t('integrations.apiKeys.name')} value={newKeyName} onChange={setNewKeyName} placeholder="Zapier" />
          <Toggle
            label={t('automationHub.scope.webhooks_manage')}
            checked={newKeyScopes.includes('webhooks.manage')}
            onChange={(v) => setNewKeyScopes((prev) => (v ? [...new Set([...prev, 'webhooks.manage' as const])] : prev.filter((s) => s !== 'webhooks.manage')))}
          />
          <Toggle
            label={t('automationHub.scope.crm_write')}
            checked={newKeyScopes.includes('crm.write')}
            onChange={(v) => setNewKeyScopes((prev) => (v ? [...new Set([...prev, 'crm.write' as const])] : prev.filter((s) => s !== 'crm.write')))}
          />
          <PrimaryButton type="submit" disabled={newKeyName.trim().length < 2 || newKeyScopes.length === 0}>
            {t('integrations.apiKeys.create')}
          </PrimaryButton>
        </form>
      </Section>

      <Section title={t('integrations.webhooks.title')}>
        {data.webhooks.length === 0 ? (
          <p className="ui-text-muted">
            {t('integrations.webhooks.empty')}
          </p>
        ) : (
          <Table head={[t('integrations.webhooks.host'), t('integrations.webhooks.events'), t('integrations.webhooks.failures'), t('integrations.webhooks.active'), '']}>
            {data.webhooks.map((w) => (
              <Tr key={w.id}>
                <Td>{w.host}</Td>
                <Td className="ui-small">{w.events.join(', ')}</Td>
                <Td className="ui-small">{w.failureCount}</Td>
                <Td>
                  <Toggle label="" checked={w.isActive} onChange={(v) => run(() => call(`webhooks/${w.id}`, 'PATCH', { isActive: v }))} />
                </Td>
                <Td className="text-right">
                  <SecondaryButton danger onClick={() => void confirm({ message: t('integrations.confirmDelete'), danger: true }).then((ok) => { if (ok) void run(() => call(`webhooks/${w.id}`, 'DELETE')); })}>
                    {t('integrations.delete')}
                  </SecondaryButton>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Section>

      <AutomationSection data={data} />

      <Section title={t('integrations.messaging.title')}>
        <ul className="space-y-1">
          {data.messaging.map((m) => (
            <li key={m.channel} className="flex items-center gap-2">
              <span className="w-24">{t(CHANNEL_LABEL[m.channel])}</span>
              <Badge tone={m.configured ? 'success' : 'warning'}>
                {m.configured ? t('integrations.messaging.configured') : t('integrations.messaging.notConfigured')}
              </Badge>
              {m.provider && <span className="ui-mono ui-caption">{m.provider}</span>}
            </li>
          ))}
        </ul>
      </Section>

      <SmsSenderSection data={data} run={run} call={call} fmtDate={fmtDate} />

      {data.platformCards.length > 0 && (
        <Section title={t('integrations.platform.title')}>
          <ul className="space-y-1">
            {data.platformCards.map((c) => (
              <li key={c.key} className="flex items-center gap-2">
                <span className="w-48">{t(PLATFORM_CARD_LABEL[c.key])}</span>
                <Badge tone={c.configured ? 'success' : 'warning'}>
                  {c.configured ? t('integrations.messaging.configured') : t('integrations.messaging.notConfigured')}
                </Badge>
                <Link href={c.href} className="pui-link pui-surface ui-caption">
                  {t('integrations.platform.open')}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function EmailDomainCard({
  domain,
  fmtDate,
  onCheck,
  onProvision,
  provisioned,
  onDelete,
}: {
  domain: EmailSenderDomainDTO;
  fmtDate: (iso: string | null) => string;
  onCheck: () => void;
  /** Only on the super admin panel (M5): create or fetch the SES identity and store its DKIM keys. */
  onProvision?: () => void;
  provisioned: SesProvisionProvider | null;
  onDelete: () => void;
}) {
  const t = useT();
  const statusLabel = (s: DnsRecordStatus) => t(`integrations.email.status.${s}` as MessageKey);
  return (
    <div className="pt-3 space-y-2 ui-rule">
      <div className="flex flex-wrap items-center gap-2">
        <span className="ui-strong">{domain.domain}</span>
        <Badge>{t(`integrations.email.purpose.${domain.purpose}` as MessageKey)}</Badge>
        <Badge tone={domain.verified ? 'success' : 'warning'}>{domain.verified ? t('integrations.email.verified') : t('integrations.email.notVerified')}</Badge>
        {domain.sesVerificationStatus && (
          <Badge tone={domain.sesVerificationStatus === 'SUCCESS' ? 'success' : 'warning'}>
            {t('integrations.email.ses.status', { status: t(`integrations.email.ses.verification.${domain.sesVerificationStatus}` as MessageKey) })}
          </Badge>
        )}
        {domain.lastCheckedAt && (
          <span className="ui-caption">
            {t('integrations.email.lastChecked', { date: fmtDate(domain.lastCheckedAt) })}
          </span>
        )}
      </div>
      <Table head={[t('integrations.email.record.type'), t('integrations.email.record.name'), t('integrations.email.record.value'), t('integrations.email.record.status')]}>
        {domain.expectedRecords.map((r) => (
          <Tr key={`${r.kind}-${r.name}`}>
            <Td className="ui-small">{r.type}</Td>
            <Td className="ui-mono break-all ui-small">{r.name}</Td>
            <Td className="ui-mono break-all ui-small">{r.value}</Td>
            <Td>
              <Badge tone={STATUS_TONE[r.status]}>{statusLabel(r.status)}</Badge>
            </Td>
          </Tr>
        ))}
      </Table>
      {domain.lastError && <InlineMessage text={domain.lastError} tone="error" />}
      {provisioned && <InlineMessage text={t(provisioned === 'MOCK' ? 'integrations.email.ses.mock' : 'integrations.email.ses.done')} />}
      <div className="flex flex-wrap gap-2">
        {onProvision && (
          <SecondaryButton onClick={onProvision}>{t('integrations.email.ses.provision')}</SecondaryButton>
        )}
        <SecondaryButton onClick={onCheck}>{t('integrations.email.check')}</SecondaryButton>
        <SecondaryButton danger onClick={onDelete}>
          {t('integrations.delete')}
        </SecondaryButton>
      </div>
    </div>
  );
}
