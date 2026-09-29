'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  INTEGRATION_ENTRY_HEADER,
  OAUTH_PROVIDER_DEFINITIONS,
  OAUTH_PROVIDER_SLUGS,
  isExpectedAuthorizeUrl,
  parseOAuthLanding,
  type HubConnectionAuthDTO,
  type HubOAuthProviderDTO,
  type IntegrationEntryPoint,
  type IntegrationHubDTO,
  type OAuthClientSettingsDTO,
  type OAuthProvider,
  type OAuthResult,
  type OAuthStartResultDTO,
  type OAuthStartTarget,
  type SocialProvider,
} from '@platform/shared';
import { bffFetch, BffError } from '@/lib/session/client';
import { useT } from '@/components/i18n/I18nProvider';
import { Badge } from '@/components/common/Badge';
import { SelectField } from '@/components/marketing/fields';
import { InlineMessage, PrimaryButton, SecondaryButton, Section, TextField } from '@/components/settings/ui';

type Run = (action: () => Promise<unknown>) => Promise<void>;
type FmtDate = (iso: string | null) => string;

/** A token expiring within this many days is flagged on the card. */
const EXPIRING_SOON_DAYS = 7;

/**
 * Starts an OAuth authorization (M4a) through the BFF (CSRF-checked POST)
 * and sends the browser to the provider, but only when the returned URL is
 * exactly the provider's authorize endpoint from the shared definitions.
 */
export function useOAuthStart(entry: IntegrationEntryPoint) {
  const t = useT();
  return useCallback(
    async (provider: OAuthProvider, target: OAuthStartTarget) => {
      const res = await bffFetch<OAuthStartResultDTO>(`platform/integrations/oauth/${OAUTH_PROVIDER_SLUGS[provider]}/start`, {
        method: 'POST',
        body: { target, returnTo: entry },
        headers: { [INTEGRATION_ENTRY_HEADER]: entry },
      });
      if (!isExpectedAuthorizeUrl(provider, res.authorizeUrl)) throw new BffError(t('integrationsOAuth.unexpectedUrl'), 502);
      window.location.assign(res.authorizeUrl);
    },
    [entry, t],
  );
}

/** Auth method, token expiry and reauth badges of one connection card. */
export function ConnectionAuthBadges({ auth, fmtDate }: { auth: HubConnectionAuthDTO; fmtDate: FmtDate }) {
  const t = useT();
  const expiresAt = auth.tokenExpiresAt ? new Date(auth.tokenExpiresAt).getTime() : null;
  const soon = expiresAt !== null && expiresAt - Date.now() < EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge tone={auth.authMethod === 'OAUTH' ? 'info' : 'neutral'}>{t(`integrationsOAuth.authMethod.${auth.authMethod}`)}</Badge>
      {auth.reauthRequired && <Badge tone="danger">{t('integrationsOAuth.reauthRequired')}</Badge>}
      {!auth.reauthRequired && soon && <Badge tone="warning">{t('integrationsOAuth.expiringSoon')}</Badge>}
      {auth.tokenExpiresAt && (
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {t('integrationsOAuth.expiresAt', { date: fmtDate(auth.tokenExpiresAt) })}
        </span>
      )}
    </span>
  );
}

/** The `?oauth=` landing message after the provider sent the browser back; the parameters are removed from the address bar. */
function useOAuthLanding(): [OAuthResult | null, () => void] {
  const [result, setResult] = useState<OAuthResult | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const parsed = parseOAuthLanding(params);
    if (!parsed) return;
    setResult(parsed);
    for (const key of ['oauth', 'provider', 'reason']) params.delete(key);
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }, []);
  return [result, () => setResult(null)];
}

/**
 * OAuth block of the integrations hub (M4a): the landing banner, one card
 * per provider with its "Connect with ..." form, and, for the super admin,
 * the client settings. The pasted-token forms elsewhere on the hub stay as
 * the fallback.
 */
export function OAuthSection({ data, entry, run, fmtDate }: { data: IntegrationHubDTO; entry: IntegrationEntryPoint; run: Run; fmtDate: FmtDate }) {
  const t = useT();
  const [landing] = useOAuthLanding();
  const provider = (p: OAuthProvider) => t(`integrationsOAuth.provider.${p}`);

  return (
    <>
      {landing && (
        <InlineMessage
          tone={landing.ok ? 'success' : 'error'}
          text={
            landing.ok
              ? t('integrationsOAuth.landing.ok', { provider: provider(landing.provider) })
              : t('integrationsOAuth.landing.error', { provider: provider(landing.provider), reason: t(`integrationsOAuth.reason.${landing.reason}`) })
          }
        />
      )}
      <Section title={t('integrationsOAuth.title')} description={t('integrationsOAuth.description')}>
        {data.oauth.providers.map((p) => (
          <ProviderConnect key={p.provider} provider={p} entry={entry} run={run} />
        ))}
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {t('integrationsOAuth.pastedFallback')}
        </p>
      </Section>
      {data.oauth.clients && <OAuthClientsSection clients={data.oauth.clients} providers={data.oauth.providers} run={run} fmtDate={fmtDate} />}
    </>
  );
}

type TargetChoice = 'AD' | SocialProvider;

function ProviderConnect({ provider, entry, run }: { provider: HubOAuthProviderDTO; entry: IntegrationEntryPoint; run: Run }) {
  const t = useT();
  const startOAuth = useOAuthStart(entry);
  const choices: TargetChoice[] = [...(provider.adPlatform ? (['AD'] as const) : []), ...provider.socialProviders];
  const [choice, setChoice] = useState<TargetChoice>(choices[0] ?? 'AD');
  const [label, setLabel] = useState('');
  const [accountId, setAccountId] = useState('');
  const [pixelId, setPixelId] = useState('');
  const [loginCustomerId, setLoginCustomerId] = useState('');
  const [conversionId, setConversionId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const name = t(`integrationsOAuth.provider.${provider.provider}`);

  const target = (): OAuthStartTarget =>
    choice === 'AD'
      ? {
          kind: 'NEW_AD_CONNECTION',
          label: label.trim(),
          externalAccountId: accountId.trim(),
          ...(provider.adPlatform === 'META' ? { pixelId: pixelId.trim() } : {}),
          ...(provider.adPlatform === 'GOOGLE' ? { conversionId: conversionId.trim(), ...(loginCustomerId.trim() ? { loginCustomerId: loginCustomerId.trim() } : {}) } : {}),
        }
      : { kind: 'NEW_SOCIAL_CONNECTION', socialProvider: choice, externalId: accountId.trim(), ...(displayName.trim() ? { displayName: displayName.trim() } : {}) };

  const ready =
    provider.configured &&
    accountId.trim().length > 0 &&
    (choice !== 'AD' || (label.trim().length > 0 && (provider.adPlatform !== 'META' || pixelId.trim().length > 0) && (provider.adPlatform !== 'GOOGLE' || conversionId.trim().length > 0)));

  return (
    <div className="border-t pt-3 space-y-2" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{name}</span>
        <Badge tone={provider.configured ? 'success' : 'warning'}>{provider.configured ? t('integrationsOAuth.configured') : t('integrationsOAuth.notConfigured')}</Badge>
      </div>
      {!provider.configured ? (
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {t('integrationsOAuth.notConfiguredHint')}
        </p>
      ) : (
        <form
          className="grid gap-3 md:grid-cols-3 items-end"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => startOAuth(provider.provider, target()));
          }}
        >
          {choices.length > 1 && (
            <SelectField
              label={t('integrationsOAuth.target')}
              value={choice}
              onChange={(v) => setChoice(choices.find((c) => c === v) ?? choices[0])}
              options={choices.map((c) => ({ value: c, label: c === 'AD' ? t('integrationsOAuth.target.AD') : t(`integrations.social.provider.${c}`) }))}
            />
          )}
          {choice === 'AD' ? (
            <>
              <TextField label={t('integrationsOAuth.field.label')} value={label} onChange={setLabel} />
              <TextField label={provider.adPlatform === 'GOOGLE' ? t('integrationsOAuth.field.customerId') : t('integrationsOAuth.field.adAccountId')} value={accountId} onChange={setAccountId} />
              {provider.adPlatform === 'META' && <TextField label={t('integrationsOAuth.field.pixelId')} value={pixelId} onChange={setPixelId} />}
              {provider.adPlatform === 'GOOGLE' && (
                <>
                  <TextField label={t('integrationsOAuth.field.loginCustomerId')} value={loginCustomerId} onChange={setLoginCustomerId} />
                  <TextField label={t('integrationsOAuth.field.conversionId')} value={conversionId} onChange={setConversionId} placeholder="AW-" />
                </>
              )}
            </>
          ) : (
            <>
              <TextField label={t('integrationsOAuth.field.externalId')} value={accountId} onChange={setAccountId} />
              <TextField label={t('integrationsOAuth.field.displayName')} value={displayName} onChange={setDisplayName} />
            </>
          )}
          <div>
            <PrimaryButton type="submit" disabled={!ready}>
              {t('integrationsOAuth.connect', { provider: name })}
            </PrimaryButton>
          </div>
        </form>
      )}
    </div>
  );
}

function OAuthClientsSection({ clients, providers, run, fmtDate }: { clients: OAuthClientSettingsDTO[]; providers: HubOAuthProviderDTO[]; run: Run; fmtDate: FmtDate }) {
  const t = useT();
  return (
    <Section title={t('integrationsOAuth.clients.title')} description={t('integrationsOAuth.clients.description')}>
      {clients.map((c) => (
        <ClientForm key={c.provider} client={c} redirectUri={providers.find((p) => p.provider === c.provider)?.redirectUri ?? ''} run={run} fmtDate={fmtDate} />
      ))}
    </Section>
  );
}

function ClientForm({ client, redirectUri, run, fmtDate }: { client: OAuthClientSettingsDTO; redirectUri: string; run: Run; fmtDate: FmtDate }) {
  const t = useT();
  const def = OAUTH_PROVIDER_DEFINITIONS[client.provider];
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [scopes, setScopes] = useState(client.scopes.join(', '));
  const [configId, setConfigId] = useState('');
  const [developerToken, setDeveloperToken] = useState('');
  const path = `admin/integrations/oauth/${OAUTH_PROVIDER_SLUGS[client.provider]}`;

  const save = () =>
    run(async () => {
      const scopeList = scopes
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      await bffFetch(path, {
        method: 'PUT',
        body: {
          clientId: clientId.trim(),
          ...(secret.trim() ? { clientSecret: secret.trim() } : {}),
          ...(scopeList.length > 0 ? { scopes: scopeList } : {}),
          ...(def.extraFields.includes('configId') && configId.trim() ? { configId: configId.trim() } : {}),
          ...(def.extraFields.includes('developerToken') && developerToken.trim() ? { developerToken: developerToken.trim() } : {}),
        },
      });
      setSecret('');
      setDeveloperToken('');
    });

  return (
    <div className="border-t pt-3 space-y-2" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{t(`integrationsOAuth.provider.${client.provider}`)}</span>
        <Badge tone={client.configured ? 'success' : 'warning'}>{client.configured ? t('integrationsOAuth.configured') : t('integrationsOAuth.notConfigured')}</Badge>
        {client.updatedAt && (
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {t('integrationsOAuth.clients.updatedAt', { date: fmtDate(client.updatedAt) })}
          </span>
        )}
      </div>
      <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        {t('integrationsOAuth.clients.redirectUri')} <code className="font-mono break-all">{redirectUri}</code>
      </p>
      {def.pkce && (
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {t('integrationsOAuth.clients.pkce')}
        </p>
      )}
      {client.clientIdPreview && (
        <p className="text-xs font-mono" style={{ color: 'var(--color-text-muted)' }}>
          {t('integrationsOAuth.clients.stored', { clientId: client.clientIdPreview, secret: client.clientSecretPreview ?? '****' })}
          {client.developerTokenPreview ? ` ${t('integrationsOAuth.clients.developerTokenStored', { token: client.developerTokenPreview })}` : ''}
        </p>
      )}
      <form
        className="grid gap-3 md:grid-cols-3 items-end"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <TextField label={t('integrationsOAuth.clients.clientId')} value={clientId} onChange={setClientId} />
        <TextField label={t('integrationsOAuth.clients.clientSecret')} value={secret} onChange={setSecret} type="password" placeholder={client.configured ? t('integrationsOAuth.clients.secretPlaceholder') : undefined} />
        <TextField label={t('integrationsOAuth.clients.scopes')} value={scopes} onChange={setScopes} placeholder={def.defaultScopes.join(', ')} />
        {def.extraFields.includes('configId') && <TextField label={t('integrationsOAuth.clients.configId')} value={configId} onChange={setConfigId} />}
        {def.extraFields.includes('developerToken') && (
          <TextField label={t('integrationsOAuth.clients.developerToken')} value={developerToken} onChange={setDeveloperToken} type="password" placeholder={client.developerTokenPreview ? t('integrationsOAuth.clients.secretPlaceholder') : undefined} />
        )}
        <div className="flex gap-2">
          <PrimaryButton type="submit" disabled={clientId.trim().length < 4}>
            {t('integrationsOAuth.clients.save')}
          </PrimaryButton>
          {client.clientIdPreview && (
            <SecondaryButton danger onClick={() => window.confirm(t('integrations.confirmDelete')) && run(() => bffFetch(path, { method: 'DELETE' }))}>
              {t('integrationsOAuth.clients.remove')}
            </SecondaryButton>
          )}
        </div>
      </form>
    </div>
  );
}
