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
} from '@platform/shared';
import { bffFetch, BffError } from '@/lib/session/client';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { Badge } from '@/components/common/Badge';
import { ErrorState, LoadingState } from '@/components/common/DataState';
import { InlineMessage, PrimaryButton, SecondaryButton, Section, SettingsHeader, TextField, Toggle } from '@/components/settings/ui';
import { AutomationSection } from './AutomationSection';
import { HubTable as Table } from './HubTable';
import { LeadAdsSection } from './LeadAdsSection';
import { SmsSenderSection } from './SmsSenderSection';

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

  return (
    <div className="space-y-6">
      <SettingsHeader title={t('integrations.title')} description={t('integrations.subtitle')} />
      {message && <InlineMessage text={message.text} tone={message.ok ? 'success' : 'error'} />}

      <Section title={t('integrations.ads.title')}>
        {data.adConnections.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {t('integrations.ads.empty')}
          </p>
        ) : (
          <Table head={['', t('integrations.ads.credential'), t('integrations.ads.lastSync'), t('integrations.ads.lastError'), t('integrations.ads.testMode'), '']}>
            {data.adConnections.map((a) => (
              <tr key={a.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                <td className="py-2 pr-3">
                  <span className="font-medium">{a.platform}</span> <span style={{ color: 'var(--color-text-secondary)' }}>{a.label}</span>
                </td>
                <td className="py-2 pr-3 font-mono text-xs">{a.credentialPreview}</td>
                <td className="py-2 pr-3 text-xs">{fmtDate(a.lastSyncAt)}</td>
                <td className="py-2 pr-3 text-xs" style={{ color: 'var(--color-danger)' }}>
                  {a.lastError ?? ''}
                </td>
                <td className="py-2 pr-3">
                  <Toggle label="" checked={a.isTestMode} onChange={(v) => run(() => call(`ads/${a.id}`, 'PATCH', { isTestMode: v }))} />
                </td>
                <td className="py-2 text-right">
                  <SecondaryButton danger onClick={() => window.confirm(t('integrations.confirmDelete')) && run(() => call(`ads/${a.id}`, 'DELETE'))}>
                    {t('integrations.delete')}
                  </SecondaryButton>
                </td>
              </tr>
            ))}
          </Table>
        )}
        <Link href={adsSettingsHref} className="text-sm underline" style={{ color: 'var(--color-text-secondary)' }}>
          {t('integrations.ads.manage')}
        </Link>
      </Section>

      <LeadAdsSection data={data} run={run} call={call} fmtDate={fmtDate} entryHeaders={headers} />

      <Section title={t('integrations.email.title')} description={t('integrations.email.description')}>
        {data.emailDomains.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {t('integrations.email.empty')}
          </p>
        )}
        {data.emailDomains.map((d) => (
          <EmailDomainCard
            key={d.id}
            domain={d}
            fmtDate={fmtDate}
            onCheck={() => run(() => call(`email-domains/${d.id}/check`, 'POST'))}
            onDelete={() => window.confirm(t('integrations.confirmDelete')) && run(() => call(`email-domains/${d.id}`, 'DELETE'))}
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
          <div className="text-sm space-y-1">
            <p>{t('integrations.apiKeys.createdOnce')}</p>
            <code className="block p-2 border text-xs break-all" style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-input)' }}>
              {newKeyPlaintext}
            </code>
          </div>
        )}
        {data.apiKeys.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {t('integrations.apiKeys.empty')}
          </p>
        ) : (
          <Table head={[t('integrations.apiKeys.name'), '', t('automationHub.scopes'), t('integrations.apiKeys.lastUsed'), '']}>
            {data.apiKeys.map((k) => (
              <tr key={k.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                <td className="py-2 pr-3">{k.name}</td>
                <td className="py-2 pr-3 font-mono text-xs">{k.prefix}</td>
                <td className="py-2 pr-3 font-mono text-xs">{k.scopes.join(', ')}</td>
                <td className="py-2 pr-3 text-xs">{fmtDate(k.lastUsedAt)}</td>
                <td className="py-2 text-right">
                  {k.revokedAt ? (
                    <Badge>{t('integrations.apiKeys.revoked')}</Badge>
                  ) : (
                    <SecondaryButton danger onClick={() => run(() => call(`api-keys/${k.id}`, 'DELETE'))}>
                      {t('integrations.apiKeys.revoke')}
                    </SecondaryButton>
                  )}
                </td>
              </tr>
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
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {t('integrations.webhooks.empty')}
          </p>
        ) : (
          <Table head={[t('integrations.webhooks.host'), t('integrations.webhooks.events'), t('integrations.webhooks.failures'), t('integrations.webhooks.active'), '']}>
            {data.webhooks.map((w) => (
              <tr key={w.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                <td className="py-2 pr-3">{w.host}</td>
                <td className="py-2 pr-3 text-xs">{w.events.join(', ')}</td>
                <td className="py-2 pr-3 text-xs">{w.failureCount}</td>
                <td className="py-2 pr-3">
                  <Toggle label="" checked={w.isActive} onChange={(v) => run(() => call(`webhooks/${w.id}`, 'PATCH', { isActive: v }))} />
                </td>
                <td className="py-2 text-right">
                  <SecondaryButton danger onClick={() => window.confirm(t('integrations.confirmDelete')) && run(() => call(`webhooks/${w.id}`, 'DELETE'))}>
                    {t('integrations.delete')}
                  </SecondaryButton>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <AutomationSection data={data} />

      <Section title={t('integrations.messaging.title')}>
        <ul className="space-y-1 text-sm">
          {data.messaging.map((m) => (
            <li key={m.channel} className="flex items-center gap-2">
              <span className="w-24">{t(CHANNEL_LABEL[m.channel])}</span>
              <Badge tone={m.configured ? 'success' : 'warning'}>
                {m.configured ? t('integrations.messaging.configured') : t('integrations.messaging.notConfigured')}
              </Badge>
              {m.provider && <span className="text-xs font-mono" style={{ color: 'var(--color-text-muted)' }}>{m.provider}</span>}
            </li>
          ))}
        </ul>
      </Section>

      <SmsSenderSection data={data} run={run} call={call} fmtDate={fmtDate} />

      {data.platformCards.length > 0 && (
        <Section title={t('integrations.platform.title')}>
          <ul className="space-y-1 text-sm">
            {data.platformCards.map((c) => (
              <li key={c.key} className="flex items-center gap-2">
                <span className="w-48">{t(PLATFORM_CARD_LABEL[c.key])}</span>
                <Badge tone={c.configured ? 'success' : 'warning'}>
                  {c.configured ? t('integrations.messaging.configured') : t('integrations.messaging.notConfigured')}
                </Badge>
                <Link href={c.href} className="text-xs underline" style={{ color: 'var(--color-text-secondary)' }}>
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
  onDelete,
}: {
  domain: EmailSenderDomainDTO;
  fmtDate: (iso: string | null) => string;
  onCheck: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const statusLabel = (s: DnsRecordStatus) => t(`integrations.email.status.${s}` as MessageKey);
  return (
    <div className="border-t pt-3 space-y-2" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{domain.domain}</span>
        <Badge>{t(`integrations.email.purpose.${domain.purpose}` as MessageKey)}</Badge>
        <Badge tone={domain.verified ? 'success' : 'warning'}>{domain.verified ? t('integrations.email.verified') : t('integrations.email.notVerified')}</Badge>
        {domain.lastCheckedAt && (
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {t('integrations.email.lastChecked', { date: fmtDate(domain.lastCheckedAt) })}
          </span>
        )}
      </div>
      <Table head={[t('integrations.email.record.type'), t('integrations.email.record.name'), t('integrations.email.record.value'), t('integrations.email.record.status')]}>
        {domain.expectedRecords.map((r) => (
          <tr key={`${r.kind}-${r.name}`} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
            <td className="py-1.5 pr-3 text-xs">{r.type}</td>
            <td className="py-1.5 pr-3 font-mono text-xs break-all">{r.name}</td>
            <td className="py-1.5 pr-3 font-mono text-xs break-all">{r.value}</td>
            <td className="py-1.5">
              <Badge tone={STATUS_TONE[r.status]}>{statusLabel(r.status)}</Badge>
            </td>
          </tr>
        ))}
      </Table>
      {domain.lastError && <InlineMessage text={domain.lastError} tone="error" />}
      <div className="flex gap-2">
        <SecondaryButton onClick={onCheck}>{t('integrations.email.check')}</SecondaryButton>
        <SecondaryButton danger onClick={onDelete}>
          {t('integrations.delete')}
        </SecondaryButton>
      </div>
    </div>
  );
}
