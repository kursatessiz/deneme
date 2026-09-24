'use client';

import { useEffect, useState } from 'react';
import { THEME_FAMILY_KEYS } from '@platform/shared';
import type { AppearancePreference, ColorSchemePreference, TenantTheme, ThemeFamilyKey } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, ErrorState } from '@/components/common/DataState';
import { PageGuard } from '@/components/common/PageGuard';
import { hasAnyPermission } from '@/lib/nav';
import { InlineMessage, PrimaryButton, Section, SettingsHeader, TextField } from '@/components/settings/ui';
import { defaultGradientForFamily, gradientPresetsForFamily, previewCssVariables, previewThemeFromForm } from '@/lib/settings/theme-preview';

const FAMILY_LABELS: Record<ThemeFamilyKey, string> = {
  noir: 'Stüdyo Noir',
  nefes: 'Nefes',
  saha: 'Saha',
  atolye: 'Atölye',
};

const COLOR_SCHEME_LABELS: Record<ColorSchemePreference, string> = {
  SYSTEM: 'Cihaz ile aynı',
  LIGHT: 'Açık',
  DARK: 'Koyu',
};

function ThemePreview({ form }: { form: TenantTheme }) {
  const resolved = previewThemeFromForm(form);
  const vars = previewCssVariables(form);
  return (
    <div
      className="p-5 space-y-4"
      style={{ ...(vars as React.CSSProperties), backgroundColor: 'var(--color-background)', borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)' }}
    >
      <div className="p-4" style={{ background: 'var(--gradient-brand)', color: 'var(--color-on-primary)', borderRadius: 'var(--radius-card)' }}>
        <p className="text-xs opacity-80">Uygulama başlık bandı</p>
        <p className="font-bold mt-1" style={{ fontFamily: 'var(--font-display)' }}>
          {resolved.family.label}
        </p>
      </div>
      <button
        type="button"
        className="px-4 py-2 text-sm font-semibold"
        style={{ background: 'var(--gradient-brand)', color: 'var(--color-on-primary)', borderRadius: 'var(--radius-button)' }}
      >
        Birincil buton
      </button>
      <p className="text-sm" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-body)' }}>
        Önizleme metni -- gövde yazı tipi ve metin renkleri
      </p>
    </div>
  );
}

function StudioThemeForm() {
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

  const gradients = gradientPresetsForFamily(form.themeFamily);

  const setFamily = (family: ThemeFamilyKey) => {
    setForm({ ...form, themeFamily: family, gradientPresetKey: defaultGradientForFamily(family).key });
  };

  const save = async () => {
    setSaveError(null);
    setSaved(false);
    if (!/^#[0-9a-fA-F]{6}$/.test(form.themePrimary)) {
      setSaveError('Renk #RRGGBB formatında olmalı');
      return;
    }
    setSaving(true);
    try {
      const updated = await bffFetch<TenantTheme>(`studios/${activeStudioId}/theme`, { method: 'PUT', body: form, studioId: activeStudioId });
      setForm(updated);
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof BffError ? err.message : 'Tema kaydedilemedi');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title="İşletme teması" description="Bütün üyelerin ve personelin gördüğü varsayılan marka: tema ailesi, logo, birincil renk ve gradyan">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div>
            <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              Tema ailesi
            </span>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {THEME_FAMILY_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFamily(key)}
                  className="px-3 py-2 text-sm border text-left"
                  style={{
                    borderRadius: 'var(--radius-input)',
                    borderColor: form.themeFamily === key ? 'var(--color-primary)' : 'var(--color-border)',
                    borderWidth: form.themeFamily === key ? 2 : 1,
                    color: 'var(--color-text-primary)',
                  }}
                >
                  {FAMILY_LABELS[key]}
                </button>
              ))}
            </div>
          </div>

          <TextField label="Logo URL" value={form.logoUrl ?? ''} onChange={(v) => setForm({ ...form, logoUrl: v || null })} placeholder="https://..." />
          <TextField label="Birincil renk (#RRGGBB)" value={form.themePrimary} onChange={(v) => setForm({ ...form, themePrimary: v })} placeholder="#2F6F5E" />

          <div>
            <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              Gradyan
            </span>
            <div className="grid grid-cols-1 gap-2 mt-1">
              {gradients.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => setForm({ ...form, gradientPresetKey: g.key })}
                  className="flex items-center gap-3 px-3 py-2 text-sm border"
                  style={{
                    borderRadius: 'var(--radius-input)',
                    borderColor: form.gradientPresetKey === g.key ? 'var(--color-primary)' : 'var(--color-border)',
                    borderWidth: form.gradientPresetKey === g.key ? 2 : 1,
                    color: 'var(--color-text-primary)',
                  }}
                >
                  <span
                    className="w-6 h-6 shrink-0"
                    style={{ borderRadius: '999px', background: `linear-gradient(${g.angle}deg, ${g.stops.join(', ')})` }}
                  />
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          {saveError && <InlineMessage text={saveError} tone="error" />}
          {saved && <InlineMessage text="Kaydedildi" tone="success" />}
          <PrimaryButton onClick={save} disabled={saving}>
            {saving ? 'Kaydediliyor...' : 'Temayı kaydet'}
          </PrimaryButton>
        </div>
        <ThemePreview form={form} />
      </div>
    </Section>
  );
}

function PersonalAppearanceForm() {
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
      const updated = await bffFetch<AppearancePreference>('me/appearance', { method: 'PUT', body: form, studioId: activeStudioId });
      setForm(updated);
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof BffError ? err.message : 'Görünüm tercihi kaydedilemedi');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title="Kişisel görünüm" description="Yalnızca bu cihazda: tema ailesi ve açık/koyu mod. İşletmenin logosu, rengi ve gradyanı değişmez.">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
        <div>
          <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            Tema ailesi
          </span>
          <select
            value={form.themeFamily ?? ''}
            onChange={(e) => setForm({ ...form, themeFamily: (e.target.value || null) as ThemeFamilyKey | null })}
            className="w-full mt-1 px-3 py-2 text-sm border"
            style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-input)', backgroundColor: 'var(--color-background)', color: 'var(--color-text-primary)' }}
          >
            <option value="">İşletme varsayılanı</option>
            {THEME_FAMILY_KEYS.map((key) => (
              <option key={key} value={key}>
                {FAMILY_LABELS[key]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            Açık / koyu mod
          </span>
          <select
            value={form.colorScheme}
            onChange={(e) => setForm({ ...form, colorScheme: e.target.value as ColorSchemePreference })}
            className="w-full mt-1 px-3 py-2 text-sm border"
            style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-input)', backgroundColor: 'var(--color-background)', color: 'var(--color-text-primary)' }}
          >
            {(['SYSTEM', 'LIGHT', 'DARK'] as const).map((key) => (
              <option key={key} value={key}>
                {COLOR_SCHEME_LABELS[key]}
              </option>
            ))}
          </select>
        </div>
      </div>
      {saveError && <InlineMessage text={saveError} tone="error" />}
      {saved && <InlineMessage text="Kaydedildi" tone="success" />}
      <PrimaryButton onClick={save} disabled={saving}>
        {saving ? 'Kaydediliyor...' : 'Kaydet'}
      </PrimaryButton>
    </Section>
  );
}

function AppearanceSettings() {
  const { permissions, isOwner } = useDashboardSession();
  const canManageStudioTheme = hasAnyPermission(['studio.settings.view', 'studio.settings.manage'], permissions, isOwner);

  return (
    <div className="space-y-6">
      <SettingsHeader title="Görünüm" description="İşletme teması ve kişisel görünüm tercihiniz" />
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
