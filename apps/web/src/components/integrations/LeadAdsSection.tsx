'use client';

import { useEffect, useState } from 'react';
import {
  LEAD_AD_FIELD_TARGETS,
  type HubLeadAdFormMappingDTO,
  type HubLeadAdsConnectionDTO,
  type IntegrationHubDTO,
  type LeadAdEventDTO,
  type LeadAdFieldTarget,
  type LeadAdsConnectionStatus,
  type LeadgenVerifyTokenSetResultDTO,
  type MessageKey,
} from '@platform/shared';
import { bffFetch, BffError } from '@/lib/session/client';
import { useT } from '@/components/i18n/I18nProvider';
import { Badge } from '@/components/common/Badge';
import { InlineMessage, PrimaryButton, SecondaryButton, Section, TextField } from '@/components/settings/ui';
import { HubTable } from './HubTable';
import { Input, Select, Tr, Td } from '@/components/ui';

const STATUS_TONE: Record<LeadAdsConnectionStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  NOT_CONFIGURED: 'warning',
  CONFIGURED: 'neutral',
  RECEIVING: 'success',
  ERROR: 'danger',
};

const EVENT_TONE: Record<LeadAdEventDTO['status'], 'neutral' | 'success' | 'warning' | 'danger'> = {
  PENDING: 'neutral',
  RETRY: 'warning',
  PROCESSED: 'success',
  FAILED: 'danger',
};

interface Props {
  data: IntegrationHubDTO;
  /** Runs a hub call, shows the saved or error message and reloads the hub. */
  run: (action: () => Promise<unknown>) => Promise<void>;
  call: (path: string, method: string, body?: unknown) => Promise<unknown>;
  fmtDate: (iso: string | null) => string;
  /** Entry point header of the hub, sent with the events request. */
  entryHeaders: Record<string, string>;
  /** The super admin console shows the platform-level cards (the webhook verify token); the marketing panel does not. */
  showPlatformCards: boolean;
}

interface FormDraft {
  formId: string;
  formName: string;
  rows: { key: string; target: LeadAdFieldTarget }[];
  consentQuestionKey: string;
  isNew: boolean;
}

function draftOf(form: HubLeadAdFormMappingDTO | null): FormDraft {
  return {
    formId: form?.formId ?? '',
    formName: form?.formName ?? '',
    rows: form ? Object.entries(form.mapping).map(([key, target]) => ({ key, target })) : [],
    consentQuestionKey: form?.consentQuestionKey ?? '',
    isNew: form === null,
  };
}

/**
 * Meta Lead Ads block of the integrations hub (M4c): per connection the
 * page id and the app secret (write-only), the intake status, the form
 * mapping editor and the recent intake events. The verify token is shown
 * only to super admins (the API returns it as null to other platform
 * members). Nothing secret is ever displayed.
 */
export function LeadAdsSection({ data, run, call, fmtDate, entryHeaders, showPlatformCards }: Props) {
  const t = useT();
  const { leadAds } = data;
  const [events, setEvents] = useState<LeadAdEventDTO[]>([]);
  const [draft, setDraft] = useState<FormDraft | null>(null);

  useEffect(() => {
    if (leadAds.connections.length === 0) return;
    bffFetch<LeadAdEventDTO[]>('platform/integrations/lead-ads/events', { headers: entryHeaders })
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [leadAds, entryHeaders]);

  return (
    <>
      <Section title={t('leadAds.title')} description={t('leadAds.description')}>
        {leadAds.connections.length === 0 ? (
          <p className="ui-text-muted">
            {t('leadAds.noConnection')}
          </p>
        ) : (
          <>
            <p className="ui-caption">
              {t('leadAds.callback')} <code className="ui-mono">/{leadAds.webhookPath}</code>
            </p>
            {leadAds.connections.map((c) => (
              <ConnectionCard key={c.connectionId} connection={c} run={run} call={call} fmtDate={fmtDate} />
            ))}
          </>
        )}
      </Section>

      {leadAds.connections.length > 0 && (
        <Section title={t('leadAds.forms.title')} description={t('leadAds.forms.description')}>
          {leadAds.forms.length === 0 && !draft && (
            <p className="ui-text-muted">
              {t('leadAds.forms.empty')}
            </p>
          )}
          {leadAds.forms.map((f) => (
            <div key={f.id} className="pt-3 flex flex-wrap items-center gap-2 ui-rule">
              <span className="ui-mono">{f.formId}</span>
              {f.formName && <span>{f.formName}</span>}
              {f.consentQuestionKey ? <Badge>{t('leadAds.forms.consentSet', { key: f.consentQuestionKey })}</Badge> : <Badge tone="warning">{t('leadAds.forms.noConsent')}</Badge>}
              <span className="flex-1" />
              <SecondaryButton onClick={() => setDraft(draftOf(f))}>{t('leadAds.forms.edit')}</SecondaryButton>
              <SecondaryButton danger onClick={() => run(() => call(`lead-ads/forms/${f.formId}`, 'DELETE'))}>
                {t('leadAds.forms.delete')}
              </SecondaryButton>
            </div>
          ))}
          {draft ? (
            <FormMappingEditor
              draft={draft}
              onChange={setDraft}
              onCancel={() => setDraft(null)}
              onSave={() =>
                run(async () => {
                  await call(`lead-ads/forms/${draft.formId}`, 'PUT', {
                    formName: draft.formName.trim() || null,
                    mapping: Object.fromEntries(draft.rows.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.target])),
                    consentQuestionKey: draft.consentQuestionKey.trim() || null,
                  });
                  setDraft(null);
                })
              }
            />
          ) : (
            <SecondaryButton onClick={() => setDraft(draftOf(null))}>{t('leadAds.forms.add')}</SecondaryButton>
          )}
        </Section>
      )}

      {leadAds.connections.length > 0 && (
        <Section title={t('leadAds.events.title')}>
          {events.length === 0 ? (
            <p className="ui-text-muted">
              {t('leadAds.events.empty')}
            </p>
          ) : (
            <HubTable head={[t('leadAds.events.received'), t('leadAds.forms.formId'), t('leadAds.events.status'), '']}>
              {events.map((e) => (
                <Tr key={e.id}>
                  <Td className="ui-small">{fmtDate(e.receivedAt)}</Td>
                  <Td className="ui-mono ui-small">{e.formId}</Td>
                  <Td>
                    <Badge tone={EVENT_TONE[e.status]}>{t(`leadAds.events.status.${e.status}` as MessageKey)}</Badge>
                    {e.lastError && (
                      <span className="ml-2 ui-text-error ui-small">
                        {e.lastError}
                      </span>
                    )}
                  </Td>
                  <Td className="text-right">
                    {e.status === 'FAILED' && <SecondaryButton onClick={() => run(() => call(`lead-ads/events/${e.id}/retry`, 'POST'))}>{t('leadAds.events.retry')}</SecondaryButton>}
                  </Td>
                </Tr>
              ))}
            </HubTable>
          )}
        </Section>
      )}

      {showPlatformCards && leadAds.verifyToken && <VerifyTokenSection state={leadAds.verifyToken} fmtDate={fmtDate} onChanged={() => run(async () => undefined)} />}
    </>
  );
}

function ConnectionCard({
  connection,
  run,
  call,
  fmtDate,
}: {
  connection: HubLeadAdsConnectionDTO;
  run: Props['run'];
  call: Props['call'];
  fmtDate: Props['fmtDate'];
}) {
  const t = useT();
  const [pageId, setPageId] = useState(connection.pageId ?? '');
  const [appSecret, setAppSecret] = useState('');
  const [subscription, setSubscription] = useState<boolean | null>(null);

  useEffect(() => setPageId(connection.pageId ?? ''), [connection.pageId]);

  const dirty = pageId.trim() !== (connection.pageId ?? '') || appSecret.trim().length > 0;

  return (
    <div className="pt-3 space-y-3 ui-rule">
      <div className="flex flex-wrap items-center gap-2">
        <span className="ui-strong">{connection.label}</span>
        <Badge tone={STATUS_TONE[connection.status]}>{t(`leadAds.status.${connection.status}` as MessageKey)}</Badge>
        <Badge tone={connection.appSecretConfigured ? 'success' : 'warning'}>
          {connection.appSecretConfigured ? t('leadAds.appSecret.set') : t('leadAds.appSecret.missing')}
        </Badge>
        <span className="ui-caption">
          {t('leadAds.lastLead')}: {connection.lastLeadAt ? fmtDate(connection.lastLeadAt) : t('leadAds.never')}
        </span>
        {connection.failedCount > 0 && (
          <Badge tone="danger">
            {t('leadAds.failed')}: {connection.failedCount}
          </Badge>
        )}
      </div>
      {connection.lastError && <InlineMessage text={connection.lastError} tone="error" />}
      <form
        className="grid gap-3 md:grid-cols-3 items-end"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await call(`lead-ads/${connection.connectionId}`, 'PUT', {
              ...(pageId.trim() !== (connection.pageId ?? '') ? { pageId: pageId.trim() || null } : {}),
              ...(appSecret.trim() ? { appSecret: appSecret.trim() } : {}),
            });
            setAppSecret('');
          });
        }}
      >
        <TextField label={t('leadAds.pageId')} value={pageId} onChange={setPageId} placeholder="1234567890" />
        <TextField label={t('leadAds.appSecret')} value={appSecret} onChange={setAppSecret} type="password" placeholder={t('leadAds.appSecret.placeholder')} />
        <div className="flex gap-2">
          <PrimaryButton type="submit" disabled={!dirty}>
            {t('leadAds.save')}
          </PrimaryButton>
          <SecondaryButton
            disabled={!connection.pageId}
            onClick={() =>
              run(async () => {
                const res = (await call(`lead-ads/${connection.connectionId}/check-subscription`, 'POST')) as { subscribed: boolean };
                setSubscription(res.subscribed);
              })
            }
          >
            {t('leadAds.checkSubscription')}
          </SecondaryButton>
        </div>
      </form>
      <p className="ui-caption">
        {t('leadAds.appSecret.note')}
      </p>
      {(subscription !== null || connection.subscribedAt) && (
        <p className="ui-caption">
          {(subscription ?? Boolean(connection.subscribedAt)) ? t('leadAds.subscription.ok') : t('leadAds.subscription.none')}
          {connection.subscribedAt && ` ${t('leadAds.subscription.at', { date: fmtDate(connection.subscribedAt) })}`}
        </p>
      )}
    </div>
  );
}

function FormMappingEditor({
  draft,
  onChange,
  onCancel,
  onSave,
}: {
  draft: FormDraft;
  onChange: (d: FormDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const t = useT();
  const formIdValid = /^\d{5,40}$/.test(draft.formId.trim());
  return (
    <div className="pt-3 space-y-3 ui-rule">
      <div className="grid gap-3 md:grid-cols-2">
        <TextField label={t('leadAds.forms.formId')} value={draft.formId} onChange={(v) => draft.isNew && onChange({ ...draft, formId: v })} placeholder="1234567890" />
        <TextField label={t('leadAds.forms.formName')} value={draft.formName} onChange={(v) => onChange({ ...draft, formName: v })} />
      </div>
      <HubTable head={[t('leadAds.forms.question'), t('leadAds.forms.target'), '']}>
        {draft.rows.map((row, index) => (
          <Tr key={index}>
            <Td>
              <Input
                value={row.key}
                onChange={(e) => onChange({ ...draft, rows: draft.rows.map((r, i) => (i === index ? { ...r, key: e.target.value } : r)) })}
                aria-label={t('leadAds.forms.question')}
                className="ui-mono"
              />
            </Td>
            <Td>
              <Select
                value={row.target}
                onChange={(e) => onChange({ ...draft, rows: draft.rows.map((r, i) => (i === index ? { ...r, target: e.target.value as LeadAdFieldTarget } : r)) })}
                aria-label={t('leadAds.forms.target')}
              >
                {LEAD_AD_FIELD_TARGETS.map((target) => (
                  <option key={target} value={target}>
                    {t(`leadAds.target.${target}` as MessageKey)}
                  </option>
                ))}
              </Select>
            </Td>
            <Td className="text-right">
              <SecondaryButton onClick={() => onChange({ ...draft, rows: draft.rows.filter((_, i) => i !== index) })}>{t('leadAds.forms.removeQuestion')}</SecondaryButton>
            </Td>
          </Tr>
        ))}
      </HubTable>
      <SecondaryButton onClick={() => onChange({ ...draft, rows: [...draft.rows, { key: '', target: 'email' }] })}>{t('leadAds.forms.addQuestion')}</SecondaryButton>
      <div className="space-y-1">
        <TextField label={t('leadAds.forms.consentQuestion')} value={draft.consentQuestionKey} onChange={(v) => onChange({ ...draft, consentQuestionKey: v })} />
        <p className="ui-caption">
          {t('leadAds.forms.consentHelp')}
        </p>
      </div>
      <div className="flex gap-2">
        <PrimaryButton disabled={!formIdValid} onClick={onSave}>
          {t('leadAds.forms.save')}
        </PrimaryButton>
        <SecondaryButton onClick={onCancel}>{t('leadAds.forms.cancel')}</SecondaryButton>
      </div>
    </div>
  );
}

function VerifyTokenSection({
  state,
  fmtDate,
  onChanged,
}: {
  state: NonNullable<IntegrationHubDTO['leadAds']['verifyToken']>;
  fmtDate: Props['fmtDate'];
  onChanged: () => void;
}) {
  const t = useT();
  const [custom, setCustom] = useState('');
  const [shown, setShown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(token: string | undefined) {
    setError(null);
    try {
      const res = await bffFetch<LeadgenVerifyTokenSetResultDTO>('admin/integrations/lead-ads/verify-token', { method: 'PUT', body: token ? { token } : {} });
      setShown(res.token);
      setCustom('');
      onChanged();
    } catch (err) {
      setError(err instanceof BffError ? err.message : t('integrations.actionFailed'));
    }
  }

  return (
    <Section title={t('leadAds.verifyToken.title')} description={t('leadAds.verifyToken.description')}>
      <p>{state.configured ? t('leadAds.verifyToken.configured', { last4: state.last4 ?? '' }) : t('leadAds.verifyToken.notConfigured')}</p>
      {state.setAt && (
        <p className="ui-caption">
          {t('leadAds.verifyToken.setAt', { date: fmtDate(state.setAt) })}
        </p>
      )}
      {shown && (
        <div className="space-y-1">
          <p>{t('leadAds.verifyToken.shownOnce')}</p>
          <code className="ui-panel block p-2 break-all ui-small ui-mono">
            {shown}
          </code>
        </div>
      )}
      {error && <InlineMessage text={error} tone="error" />}
      <div className="flex flex-wrap gap-3 items-end">
        <TextField label={t('leadAds.verifyToken.custom')} value={custom} onChange={setCustom} type="password" />
        <PrimaryButton disabled={!/^[A-Za-z0-9_-]{16,128}$/.test(custom)} onClick={() => save(custom)}>
          {t('leadAds.verifyToken.set')}
        </PrimaryButton>
        <SecondaryButton onClick={() => save(undefined)}>{t('leadAds.verifyToken.generate')}</SecondaryButton>
      </div>
    </Section>
  );
}
