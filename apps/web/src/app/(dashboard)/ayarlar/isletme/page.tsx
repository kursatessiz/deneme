'use client';

import { useEffect, useState } from 'react';
import type {
  FeedbackSettingsDTO,
  GamificationSettingsDTO,
  MessageChannelName,
  NotificationSettings,
  PublicLanguagesDTO,
  StudioRegion,
  TaxRegime,
  UpdateCheckInWindowInput,
} from '@platform/shared';
import { TAX_REGIMES } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, ErrorState } from '@/components/common/DataState';
import { PageGuard } from '@/components/common/PageGuard';
import { hasAnyPermission } from '@/lib/nav';
import { InlineMessage, PrimaryButton, Section, SettingsHeader, TextField, Toggle } from '@/components/settings/ui';
import { validateEmbedOrigin, validateGoogleReviewUrl } from '@/lib/settings/url-validation';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { FieldGroup } from '@/components/ui/FieldGroup';
import { Button } from '@/components/ui/Button';
import { List, ListItem } from '@/components/ui/List';

interface CancellationPolicyRow {
  id: string;
  name: string;
  freeCancelHours: number;
  lateCancelChargeUnits: number;
  noShowChargeUnits: number;
  isDefault: boolean;
  isActive: boolean;
}

function useSave<T>(studioId: string, path: string, initial: T | null) {
  const t = useT();
  const [form, setForm] = useState<T | null>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => setForm(initial), [initial]);
  const save = async (body: T) => {
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const updated = await bffFetch<T>(path, { method: 'PUT', body, studioId });
      setForm(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof BffError ? err.message : t('common.saveFailed'));
    } finally {
      setSaving(false);
    }
  };
  return { form, setForm, saving, error, saved, save };
}

function CancellationPolicySection() {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const { data, loading, error } = useBff<CancellationPolicyRow[]>(`catalog/cancellation-policies/studio/${activeStudioId}`, activeStudioId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ freeCancelHours: number; lateCancelChargeUnits: number; noShowChargeUnits: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const startEdit = (row: CancellationPolicyRow) => {
    setEditingId(row.id);
    setDraft({ freeCancelHours: row.freeCancelHours, lateCancelChargeUnits: row.lateCancelChargeUnits, noShowChargeUnits: row.noShowChargeUnits });
  };

  const save = async () => {
    if (!editingId || !draft) return;
    setSaveError(null);
    setSaving(true);
    try {
      await bffFetch(`catalog/cancellation-policies/${editingId}`, { method: 'PATCH', body: { studioId: activeStudioId, ...draft }, studioId: activeStudioId });
      setEditingId(null);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setSaveError(err instanceof BffError ? err.message : t('settings.business.cancellation.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title={t('settings.business.cancellation.title')} description={t('settings.business.cancellation.description')} key={refreshKey}>
      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {saveError && <InlineMessage text={saveError} tone="error" />}
      {!loading && !error && data && data.length > 0 && (
        <List className="ui-divide">
          {data.map((row) => (
            <ListItem key={row.id}>
              <p className="ui-strong">
                {row.name} {row.isDefault && t('settings.business.cancellation.default')}
              </p>
              {editingId === row.id && draft ? (
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-xl">
                  <FieldGroup label={t('settings.business.cancellation.freeCancelHours')}>
                    <Input
                      type="number"
                      min={0}
                      value={draft.freeCancelHours}
                      onChange={(e) => setDraft({ ...draft, freeCancelHours: Number(e.target.value) })}
                    />
                  </FieldGroup>
                  <FieldGroup label={t('settings.business.cancellation.lateCancelUnits')}>
                    <Input
                      type="number"
                      min={0}
                      value={draft.lateCancelChargeUnits}
                      onChange={(e) => setDraft({ ...draft, lateCancelChargeUnits: Number(e.target.value) })}
                    />
                  </FieldGroup>
                  <FieldGroup label={t('settings.business.cancellation.noShowUnits')}>
                    <Input
                      type="number"
                      min={0}
                      value={draft.noShowChargeUnits}
                      onChange={(e) => setDraft({ ...draft, noShowChargeUnits: Number(e.target.value) })}
                    />
                  </FieldGroup>
                  <div className="col-span-full flex gap-2">
                    <PrimaryButton onClick={save} disabled={saving}>
                      {saving ? t('common.saving') : t('common.save')}
                    </PrimaryButton>
                  </div>
                </div>
              ) : (
                <p className="ui-caption mt-1">
                  {t('settings.business.cancellation.summary', {
                    hours: row.freeCancelHours,
                    lateUnits: row.lateCancelChargeUnits,
                    noShowUnits: row.noShowChargeUnits,
                  })}
                  {' -- '}
                  <Button variant="link" size="sm" onClick={() => startEdit(row)}>
                    {t('settings.business.cancellation.edit')}
                  </Button>
                </p>
              )}
            </ListItem>
          ))}
        </List>
      )}
    </Section>
  );
}

function CheckInWindowSection() {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const { data, loading, error } = useBff<UpdateCheckInWindowInput>(`studios/${activeStudioId}/check-in/window`, activeStudioId);
  const {
    form,
    setForm,
    saving,
    error: saveError,
    saved,
    save,
  } = useSave<UpdateCheckInWindowInput>(activeStudioId, `studios/${activeStudioId}/check-in/window`, data);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!form) return null;

  return (
    <Section title={t('settings.business.checkIn.title')} description={t('settings.business.checkIn.description')}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-md">
        <FieldGroup label={t('settings.business.checkIn.before')}>
          <Input type="number" min={0} max={180} value={form.beforeMinutes} onChange={(e) => setForm({ ...form, beforeMinutes: Number(e.target.value) })} />
        </FieldGroup>
        <FieldGroup label={t('settings.business.checkIn.after')}>
          <Input type="number" min={0} max={180} value={form.afterMinutes} onChange={(e) => setForm({ ...form, afterMinutes: Number(e.target.value) })} />
        </FieldGroup>
      </div>
      {saveError && <InlineMessage text={saveError} tone="error" />}
      {saved && <InlineMessage text={t('settings.appearance.saved')} tone="success" />}
      <PrimaryButton onClick={() => save(form)} disabled={saving}>
        {saving ? t('common.saving') : t('common.save')}
      </PrimaryButton>
    </Section>
  );
}

function LocaleSection() {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const { data: languages } = useBff<PublicLanguagesDTO>('i18n/languages', null);
  const { data, loading, error } = useBff<{ defaultLocale: string }>(`studios/${activeStudioId}/locale`, activeStudioId);
  const { form, setForm, saving, error: saveError, saved, save } = useSave<{ defaultLocale: string }>(activeStudioId, `studios/${activeStudioId}/locale`, data);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!form) return null;

  return (
    <Section title={t('settings.business.locale.title')} description={t('settings.business.locale.description')}>
      <div className="max-w-xs">
        <Select value={form.defaultLocale} onChange={(e) => setForm({ defaultLocale: e.target.value })} className="w-full">
          {(languages?.items ?? []).map((l) => (
            <option key={l.code} value={l.code}>
              {l.nativeName}
            </option>
          ))}
        </Select>
      </div>
      {saveError && <InlineMessage text={saveError} tone="error" />}
      {saved && <InlineMessage text={t('settings.appearance.saved')} tone="success" />}
      <PrimaryButton onClick={() => save(form)} disabled={saving}>
        {saving ? t('common.saving') : t('common.save')}
      </PrimaryButton>
    </Section>
  );
}

function RegionSection() {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const { data, loading, error } = useBff<StudioRegion>(`studios/${activeStudioId}/region`, activeStudioId);
  const { form, setForm, saving, error: saveError, saved, save } = useSave<StudioRegion>(activeStudioId, `studios/${activeStudioId}/region`, data);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!form) return null;

  return (
    <Section title={t('settings.business.region.title')} description={t('settings.business.region.description')}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
        <TextField
          label={t('settings.business.region.countryCode')}
          value={form.countryCode}
          onChange={(v) => setForm({ ...form, countryCode: v.toUpperCase() })}
        />
        <TextField label={t('settings.business.region.currency')} value={form.currency} onChange={(v) => setForm({ ...form, currency: v.toUpperCase() })} />
        <TextField label={t('settings.business.region.timezone')} value={form.timezone} onChange={(v) => setForm({ ...form, timezone: v })} />
        <FieldGroup label={t('settings.business.region.taxRegime')}>
          <Select value={form.taxRegime} onChange={(e) => setForm({ ...form, taxRegime: e.target.value as TaxRegime })}>
            {TAX_REGIMES.map((regime) => (
              <option key={regime} value={regime}>
                {t(`settings.business.taxRegime.${regime}`)}
              </option>
            ))}
          </Select>
        </FieldGroup>
        <Toggle
          label={t('settings.business.region.pricesIncludeTax')}
          checked={form.pricesIncludeTax}
          onChange={(v) => setForm({ ...form, pricesIncludeTax: v })}
        />
      </div>
      {saveError && <InlineMessage text={saveError} tone="error" />}
      {saved && <InlineMessage text={t('settings.appearance.saved')} tone="success" />}
      <PrimaryButton onClick={() => save(form)} disabled={saving}>
        {saving ? t('common.saving') : t('common.save')}
      </PrimaryButton>
    </Section>
  );
}

function NotificationChannelSection() {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const { data, loading, error } = useBff<NotificationSettings>(`studios/${activeStudioId}/notification-settings`, activeStudioId);
  const { data: wallet } = useBff<{ balance: number; lowBalanceThreshold: number }>(`studios/${activeStudioId}/sms-wallet`, activeStudioId);
  const {
    form,
    setForm,
    saving,
    error: saveError,
    saved,
    save,
  } = useSave<NotificationSettings>(activeStudioId, `studios/${activeStudioId}/notification-settings`, data);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!form) return null;

  const moveChannel = (channel: MessageChannelName, dir: -1 | 1) => {
    const idx = form.order.indexOf(channel);
    const swapWith = idx + dir;
    if (swapWith < 0 || swapWith >= form.order.length) return;
    const next = [...form.order];
    [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
    setForm({ ...form, order: next });
  };

  return (
    <Section title={t('settings.business.notifications.title')} description={t('settings.business.notifications.description')}>
      <div className="space-y-2 max-w-md">
        {form.order.map((channel, idx) => (
          <div key={channel} className="pui-card flex items-center justify-between px-3 py-2">
            <span>
              {idx + 1}. {t(`settings.business.channel.${channel}`)}
            </span>
            <div className="flex gap-1">
              <Button variant="link" tone="muted" size="sm" disabled={idx === 0} onClick={() => moveChannel(channel, -1)}>
                {t('settings.business.notifications.moveUp')}
              </Button>
              <Button variant="link" tone="muted" size="sm" disabled={idx === form.order.length - 1} onClick={() => moveChannel(channel, 1)}>
                {t('settings.business.notifications.moveDown')}
              </Button>
            </div>
          </div>
        ))}
        <Toggle
          label={t('settings.business.notifications.whatsappEnabled')}
          checked={form.whatsappEnabled}
          onChange={(v) => setForm({ ...form, whatsappEnabled: v })}
        />
        <TextField
          label={t('settings.business.notifications.smsSenderName')}
          value={form.smsSenderName ?? ''}
          onChange={(v) => setForm({ ...form, smsSenderName: v || undefined })}
          placeholder={t('settings.business.notifications.smsSenderPlaceholder')}
        />
      </div>
      {wallet && <p className="ui-caption">{t('settings.business.notifications.smsBalance', { balance: wallet.balance })}</p>}
      {saveError && <InlineMessage text={saveError} tone="error" />}
      {saved && <InlineMessage text={t('settings.appearance.saved')} tone="success" />}
      <PrimaryButton onClick={() => save(form)} disabled={saving}>
        {saving ? t('common.saving') : t('common.save')}
      </PrimaryButton>
    </Section>
  );
}

function GamificationSection() {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const { data, loading, error } = useBff<GamificationSettingsDTO>(`gamification/studio/${activeStudioId}/settings`, activeStudioId);
  const {
    form,
    setForm,
    saving: _saving,
    error: saveError,
    saved,
    save,
  } = useSave<GamificationSettingsDTO>(activeStudioId, `gamification/studio/${activeStudioId}/settings`, data);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!form) return null;

  return (
    <Section title={t('settings.business.gamification.title')} description={t('settings.business.gamification.description')}>
      <Toggle
        label={t('settings.business.gamification.enabled')}
        checked={form.enabled}
        onChange={(v) => {
          setForm({ enabled: v });
          save({ enabled: v });
        }}
      />
      {saveError && <InlineMessage text={saveError} tone="error" />}
      {saved && <InlineMessage text={t('settings.appearance.saved')} tone="success" />}
    </Section>
  );
}

function FeedbackSection() {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const { data, loading, error } = useBff<FeedbackSettingsDTO>(`studios/${activeStudioId}/feedback-settings`, activeStudioId);
  const {
    form,
    setForm,
    saving,
    error: saveError,
    saved,
    save,
  } = useSave<FeedbackSettingsDTO>(activeStudioId, `studios/${activeStudioId}/feedback-settings`, data);
  const [urlError, setUrlError] = useState<string | null>(null);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!form) return null;

  const doSave = () => {
    setUrlError(null);
    if (form.googleReviewUrl) {
      const check = validateGoogleReviewUrl(form.googleReviewUrl, { invalidLink: t('common.invalidLink') });
      if (!check.valid) {
        setUrlError(check.error);
        return;
      }
    }
    save(form);
  };

  return (
    <Section title={t('settings.business.feedback.title')} description={t('settings.business.feedback.description')}>
      <div className="max-w-lg space-y-3">
        <TextField
          label={t('settings.business.feedback.googleReviewUrl')}
          value={form.googleReviewUrl ?? ''}
          onChange={(v) => setForm({ ...form, googleReviewUrl: v || null })}
          placeholder="https://g.page/..."
          error={urlError}
        />
        <FieldGroup label={t('settings.business.feedback.referralRewardUnits')}>
          <Input
            type="number"
            min={0}
            max={50}
            value={form.referralRewardUnits}
            onChange={(e) => setForm({ ...form, referralRewardUnits: Number(e.target.value) })}
          />
        </FieldGroup>
      </div>
      {saveError && <InlineMessage text={saveError} tone="error" />}
      {saved && <InlineMessage text={t('settings.appearance.saved')} tone="success" />}
      <PrimaryButton onClick={doSave} disabled={saving}>
        {saving ? t('common.saving') : t('common.save')}
      </PrimaryButton>
    </Section>
  );
}

function EmbedOriginsSection() {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const { data, loading, error: loadError } = useBff<{ id: string; embedAllowedOrigins: string[] }>(`studios/${activeStudioId}/embed-settings`, activeStudioId);
  const [origins, setOrigins] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) setOrigins(data.embedAllowedOrigins);
  }, [data]);

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    const check = validateEmbedOrigin(v, { invalidOrigin: t('common.invalidOrigin') });
    if (!check.valid) {
      setDraftError(check.error);
      return;
    }
    setDraftError(null);
    setOrigins((prev) => (prev.includes(v) ? prev : [...prev, v]));
    setDraft('');
  };

  const doSave = async () => {
    setSaveError(null);
    setSaved(false);
    setSaving(true);
    try {
      await bffFetch(`studios/${activeStudioId}/embed-settings`, { method: 'PUT', body: { embedAllowedOrigins: origins }, studioId: activeStudioId });
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof BffError ? err.message : t('common.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title={t('settings.business.embed.title')} description={t('settings.business.embed.description')}>
      {loading && <LoadingState />}
      {loadError && <InlineMessage text={t('settings.business.embed.errors.loadFailed')} tone="error" />}
      <div className="flex gap-2 max-w-lg">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('settings.business.embed.placeholder')} className="flex-1" />
        <PrimaryButton onClick={add}>{t('common.add')}</PrimaryButton>
      </div>
      {draftError && <InlineMessage text={draftError} tone="error" />}
      {origins.length > 0 && (
        <List>
          {origins.map((o) => (
            <ListItem key={o} className="flex items-center justify-between">
              {o}
              <Button variant="link" size="sm" onClick={() => setOrigins((prev) => prev.filter((x) => x !== o))}>
                {t('settings.business.embed.remove')}
              </Button>
            </ListItem>
          ))}
        </List>
      )}
      {saveError && <InlineMessage text={saveError} tone="error" />}
      {saved && <InlineMessage text={t('settings.appearance.saved')} tone="success" />}
      <PrimaryButton onClick={doSave} disabled={saving}>
        {saving ? t('common.saving') : t('common.save')}
      </PrimaryButton>
    </Section>
  );
}

function BusinessSettings() {
  const t = useT();
  const { permissions, isOwner } = useDashboardSession();
  const canCatalog = hasAnyPermission(['catalog.view', 'catalog.manage'], permissions, isOwner);
  const canStudio = hasAnyPermission(['studio.settings.view', 'studio.settings.manage'], permissions, isOwner);
  const canNotify = hasAnyPermission(['notifications.manage'], permissions, isOwner);
  const canGamify = hasAnyPermission(['reports.view', 'studio.settings.manage'], permissions, isOwner);
  const canIntegrations = hasAnyPermission(['integrations.manage'], permissions, isOwner);

  return (
    <div className="grid gap-6">
      <SettingsHeader title={t('settings.business.title')} description={t('settings.business.description')} />
      {canCatalog && <CancellationPolicySection />}
      {canStudio && <RegionSection />}
      {canStudio && <LocaleSection />}
      {canStudio && <CheckInWindowSection />}
      {canNotify && <NotificationChannelSection />}
      {canGamify && <GamificationSection />}
      {canStudio && <FeedbackSection />}
      {canIntegrations && <EmbedOriginsSection />}
    </div>
  );
}

export default function BusinessSettingsPage() {
  return (
    <PageGuard required={['studio.settings.view', 'studio.settings.manage', 'notifications.manage', 'catalog.manage', 'catalog.view']}>
      <BusinessSettings />
    </PageGuard>
  );
}
