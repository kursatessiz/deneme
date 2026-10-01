'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { COLOR_SCHEME_PREFERENCES } from '@platform/shared';
import type { AppearancePreference, ColorSchemePreference, TenantTheme } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, ErrorState } from '@/components/common/DataState';
import { PageGuard } from '@/components/common/PageGuard';
import { hasAnyPermission } from '@/lib/nav';
import { InlineMessage, PrimaryButton, Section, SettingsHeader, TextField } from '@/components/settings/ui';
import { previewCssVariables } from '@/lib/settings/theme-preview';
import { Button } from '@/components/ui/Button';
import { Radio } from '@/components/ui/Radio';

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Live preview of the unsaved form: the two gradient slots (member card,
 * package card) and a flat primary button, in light mode.
 */
function ThemePreview({ form }: { form: TenantTheme }) {
  const t = useT();
  const vars = previewCssVariables(form);
  return (
    <div className="pui-card" data-pui-mode="light" style={{ ...(vars as React.CSSProperties), colorScheme: 'light' }}>
      <div className="pui-card-content gap-4">
        <div className="pui-card ui-gradient-member-card p-4 grid gap-1">
          <span className="ui-caption" style={{ color: 'inherit', opacity: 0.85 }}>
            {t('settings.appearance.preview.memberCard')}
          </span>
          <span className="ui-heading">{form.themePrimary.toUpperCase()}</span>
        </div>
        <div className="pui-card ui-gradient-package-card p-4 grid gap-1">
          <span className="ui-caption" style={{ color: 'inherit', opacity: 0.85 }}>
            {t('settings.appearance.preview.packageCard')}
          </span>
          <span className="ui-stat-value">8/10</span>
          <span className="ui-caption" style={{ color: 'inherit', opacity: 0.85 }}>
            {t('settings.appearance.preview.remaining')}
          </span>
        </div>
        <Button className="justify-self-start">{t('settings.appearance.preview.primaryButton')}</Button>
        <p>{t('settings.appearance.preview.bodyText')}</p>
      </div>
    </div>
  );
}

function StudioThemeForm() {
  const t = useT();
  const router = useRouter();
  const { activeStudioId } = useDashboardSession();
  const { data, loading, error } = useBff<TenantTheme>(`studios/${activeStudioId}/theme`, activeStudioId);
  const [form, setForm] = useState<TenantTheme | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!form) return null;

  const save = async () => {
    setSaveError(null);
    setSaved(false);
    if (!HEX.test(form.themePrimary)) {
      setSaveError(t('settings.appearance.colorFormatError'));
      return;
    }
    setSaving(true);
    try {
      // The stored family and gradient key are sent back unchanged: since T1 they no longer change what renders.
      const updated = await bffFetch<TenantTheme>(`studios/${activeStudioId}/theme`, { method: 'PUT', body: form, studioId: activeStudioId });
      setForm(updated);
      setSaved(true);
      router.refresh();
    } catch (err) {
      setSaveError(err instanceof BffError ? err.message : t('settings.appearance.errors.themeSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title={t('settings.appearance.studioTheme.title')} description={t('settings.appearance.studioTheme.description')}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="grid gap-4 content-start">
          <TextField label={t('settings.appearance.logoUrl')} value={form.logoUrl ?? ''} onChange={(v) => setForm({ ...form, logoUrl: v || null })} placeholder="https://..." />
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <TextField label={t('settings.appearance.primaryColor')} value={form.themePrimary} onChange={(v) => setForm({ ...form, themePrimary: v })} placeholder="#0092CD" />
            </div>
            <input
              type="color"
              aria-label={t('settings.appearance.primaryColor')}
              className="pui-input"
              style={{ width: '2.5rem', height: '2.125rem', padding: 2 }}
              value={HEX.test(form.themePrimary) ? form.themePrimary : '#0092cd'}
              onChange={(e) => setForm({ ...form, themePrimary: e.target.value.toUpperCase() })}
            />
          </div>
          {saveError && <InlineMessage text={saveError} tone="error" />}
          {saved && <InlineMessage text={t('settings.appearance.saved')} tone="success" />}
          <PrimaryButton onClick={save} disabled={saving}>
            {saving ? t('common.saving') : t('settings.appearance.saveTheme')}
          </PrimaryButton>
        </div>
        <ThemePreview form={form} />
      </div>
    </Section>
  );
}

function PersonalAppearanceForm() {
  const t = useT();
  const router = useRouter();
  const { activeStudioId } = useDashboardSession();
  const { data, loading, error } = useBff<AppearancePreference>('me/appearance', activeStudioId);
  const [form, setForm] = useState<AppearancePreference | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!form) return null;

  const save = async () => {
    setSaveError(null);
    setSaved(false);
    setSaving(true);
    try {
      // themeFamily is kept as stored (legacy field, accepted and ignored).
      const updated = await bffFetch<AppearancePreference>('me/appearance', { method: 'PUT', body: form, studioId: activeStudioId });
      setForm(updated);
      setSaved(true);
      router.refresh();
    } catch (err) {
      setSaveError(err instanceof BffError ? err.message : t('settings.appearance.errors.personalSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title={t('settings.appearance.personal.title')} description={t('settings.appearance.personal.description')}>
      <fieldset className="grid gap-2">
        <legend className="ui-caption mb-2">{t('settings.appearance.personal.colorSchemeLabel')}</legend>
        {COLOR_SCHEME_PREFERENCES.map((key: ColorSchemePreference) => (
          <Radio
            key={key}
            name="color-scheme"
            value={key}
            checked={form.colorScheme === key}
            onChange={() => setForm({ ...form, colorScheme: key })}
            label={t(`settings.appearance.colorScheme.${key}`)}
          />
        ))}
      </fieldset>
      {saveError && <InlineMessage text={saveError} tone="error" />}
      {saved && <InlineMessage text={t('settings.appearance.saved')} tone="success" />}
      <PrimaryButton onClick={save} disabled={saving}>
        {saving ? t('common.saving') : t('common.save')}
      </PrimaryButton>
    </Section>
  );
}

function AppearanceSettings() {
  const t = useT();
  const { permissions, isOwner } = useDashboardSession();
  const canManageStudioTheme = hasAnyPermission(['studio.settings.view', 'studio.settings.manage'], permissions, isOwner);

  return (
    <div className="grid gap-6">
      <SettingsHeader title={t('settings.appearance.title')} description={t('settings.appearance.description')} />
      {canManageStudioTheme && <StudioThemeForm />}
      <PersonalAppearanceForm />
    </div>
  );
}

export default function AppearancePage() {
  return (
    // Everyone reaches this page for their own appearance; the studio-theme
    // section inside additionally checks studio.settings.view/manage.
    <PageGuard required={[]}>
      <AppearanceSettings />
    </PageGuard>
  );
}
