'use client';

import { useEffect, useState } from 'react';
import type {
  FeedbackSettingsDTO,
  GamificationSettingsDTO,
  MessageChannelName,
  NotificationSettings,
  UpdateCheckInWindowInput,
} from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, ErrorState } from '@/components/common/DataState';
import { PageGuard } from '@/components/common/PageGuard';
import { hasAnyPermission } from '@/lib/nav';
import { InlineMessage, PrimaryButton, Section, SettingsHeader, TextField, Toggle } from '@/components/settings/ui';
import { validateEmbedOrigin, validateGoogleReviewUrl } from '@/lib/settings/url-validation';

interface CancellationPolicyRow {
  id: string;
  name: string;
  freeCancelHours: number;
  lateCancelChargeUnits: number;
  noShowChargeUnits: number;
  isDefault: boolean;
  isActive: boolean;
}

const CHANNEL_LABELS: Record<MessageChannelName, string> = { WHATSAPP: 'WhatsApp', SMS: 'SMS' };

function useSave<T>(studioId: string, path: string, initial: T | null) {
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
      setError(err instanceof BffError ? err.message : 'Kaydedilemedi');
    } finally {
      setSaving(false);
    }
  };
  return { form, setForm, saving, error, saved, save };
}

function CancellationPolicySection() {
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
      setSaveError(err instanceof BffError ? err.message : 'Politika kaydedilemedi');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title="İptal politikası" description="Ücretsiz iptal süresi ve geç iptal/gelmeme ceza birimleri" key={refreshKey}>
      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {saveError && <InlineMessage text={saveError} tone="error" />}
      {!loading && !error && data && data.length > 0 && (
        <div className="space-y-3">
          {data.map((row) => (
            <div key={row.id} className="border-b last:border-b-0 pb-3" style={{ borderColor: 'var(--color-border)' }}>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                {row.name} {row.isDefault && '(varsayılan)'}
              </p>
              {editingId === row.id && draft ? (
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-xl">
                  <label className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    Ücretsiz iptal (saat)
                    <input
                      type="number"
                      min={0}
                      value={draft.freeCancelHours}
                      onChange={(e) => setDraft({ ...draft, freeCancelHours: Number(e.target.value) })}
                      className="w-full mt-1 px-2 py-1.5 border text-sm"
                      style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-input)', backgroundColor: 'var(--color-background)', color: 'var(--color-text-primary)' }}
                    />
                  </label>
                  <label className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    Geç iptal (birim)
                    <input
                      type="number"
                      min={0}
                      value={draft.lateCancelChargeUnits}
                      onChange={(e) => setDraft({ ...draft, lateCancelChargeUnits: Number(e.target.value) })}
                      className="w-full mt-1 px-2 py-1.5 border text-sm"
                      style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-input)', backgroundColor: 'var(--color-background)', color: 'var(--color-text-primary)' }}
                    />
                  </label>
                  <label className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    Gelmeme (birim)
                    <input
                      type="number"
                      min={0}
                      value={draft.noShowChargeUnits}
                      onChange={(e) => setDraft({ ...draft, noShowChargeUnits: Number(e.target.value) })}
                      className="w-full mt-1 px-2 py-1.5 border text-sm"
                      style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-input)', backgroundColor: 'var(--color-background)', color: 'var(--color-text-primary)' }}
                    />
                  </label>
                  <div className="col-span-full flex gap-2">
                    <PrimaryButton onClick={save} disabled={saving}>
                      {saving ? 'Kaydediliyor...' : 'Kaydet'}
                    </PrimaryButton>
                  </div>
                </div>
              ) : (
                <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                  {row.freeCancelHours} saat öncesine kadar ücretsiz -- geç iptalde {row.lateCancelChargeUnits}, gelmemede {row.noShowChargeUnits} birim kesilir
                  {' -- '}
                  <button type="button" className="underline" onClick={() => startEdit(row)}>
                    düzenle
                  </button>
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function CheckInWindowSection() {
  const { activeStudioId } = useDashboardSession();
  const { data, loading, error } = useBff<UpdateCheckInWindowInput>(`studios/${activeStudioId}/check-in/window`, activeStudioId);
  const { form, setForm, saving, error: saveError, saved, save } = useSave<UpdateCheckInWindowInput>(activeStudioId, `studios/${activeStudioId}/check-in/window`, data);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!form) return null;

  return (
    <Section title="Check-in penceresi" description="Üyenin seans başlamadan önce ve sonra check-in yapabileceği süre">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-md">
        <label className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          Önce (dakika)
          <input
            type="number"
            min={0}
            max={180}
            value={form.beforeMinutes}
            onChange={(e) => setForm({ ...form, beforeMinutes: Number(e.target.value) })}
            className="w-full mt-1 px-2 py-1.5 border text-sm"
            style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-input)', backgroundColor: 'var(--color-background)', color: 'var(--color-text-primary)' }}
          />
        </label>
        <label className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          Sonra (dakika)
          <input
            type="number"
            min={0}
            max={180}
            value={form.afterMinutes}
            onChange={(e) => setForm({ ...form, afterMinutes: Number(e.target.value) })}
            className="w-full mt-1 px-2 py-1.5 border text-sm"
            style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-input)', backgroundColor: 'var(--color-background)', color: 'var(--color-text-primary)' }}
          />
        </label>
      </div>
      {saveError && <InlineMessage text={saveError} tone="error" />}
      {saved && <InlineMessage text="Kaydedildi" tone="success" />}
      <PrimaryButton onClick={() => save(form)} disabled={saving}>
        {saving ? 'Kaydediliyor...' : 'Kaydet'}
      </PrimaryButton>
    </Section>
  );
}

function NotificationChannelSection() {
  const { activeStudioId } = useDashboardSession();
  const { data, loading, error } = useBff<NotificationSettings>(`studios/${activeStudioId}/notification-settings`, activeStudioId);
  const { data: wallet } = useBff<{ balance: number; lowBalanceThreshold: number }>(`studios/${activeStudioId}/sms-wallet`, activeStudioId);
  const { form, setForm, saving, error: saveError, saved, save } = useSave<NotificationSettings>(activeStudioId, `studios/${activeStudioId}/notification-settings`, data);

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
    <Section title="Bildirim kanalları" description="Kanal deneme sırası ve fallback; WhatsApp kapatılırsa doğrudan SMS'e düşer">
      <div className="space-y-2 max-w-md">
        {form.order.map((channel, idx) => (
          <div key={channel} className="flex items-center justify-between px-3 py-2 border" style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-input)' }}>
            <span className="text-sm" style={{ color: 'var(--color-text-primary)' }}>
              {idx + 1}. {CHANNEL_LABELS[channel]}
            </span>
            <div className="flex gap-1">
              <button type="button" disabled={idx === 0} onClick={() => moveChannel(channel, -1)} className="text-xs px-2 py-1 disabled:opacity-30">
                Yukarı
              </button>
              <button type="button" disabled={idx === form.order.length - 1} onClick={() => moveChannel(channel, 1)} className="text-xs px-2 py-1 disabled:opacity-30">
                Aşağı
              </button>
            </div>
          </div>
        ))}
        <Toggle label="WhatsApp etkin" checked={form.whatsappEnabled} onChange={(v) => setForm({ ...form, whatsappEnabled: v })} />
        <TextField label="SMS gönderen başlığı" value={form.smsSenderName ?? ''} onChange={(v) => setForm({ ...form, smsSenderName: v || undefined })} placeholder="En fazla 11 karakter" />
      </div>
      {wallet && (
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          SMS bakiyesi: {wallet.balance} kredi
        </p>
      )}
      {saveError && <InlineMessage text={saveError} tone="error" />}
      {saved && <InlineMessage text="Kaydedildi" tone="success" />}
      <PrimaryButton onClick={() => save(form)} disabled={saving}>
        {saving ? 'Kaydediliyor...' : 'Kaydet'}
      </PrimaryButton>
    </Section>
  );
}

function GamificationSection() {
  const { activeStudioId } = useDashboardSession();
  const { data, loading, error } = useBff<GamificationSettingsDTO>(`gamification/studio/${activeStudioId}/settings`, activeStudioId);
  const { form, setForm, saving, error: saveError, saved, save } = useSave<GamificationSettingsDTO>(activeStudioId, `gamification/studio/${activeStudioId}/settings`, data);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!form) return null;

  return (
    <Section title="Oyunlaştırma" description="Seri, kilometre taşı, rozet ve aylık hedef özellikleri">
      <Toggle label="Oyunlaştırma etkin" checked={form.enabled} onChange={(v) => { setForm({ enabled: v }); save({ enabled: v }); }} />
      {saveError && <InlineMessage text={saveError} tone="error" />}
      {saved && <InlineMessage text="Kaydedildi" tone="success" />}
    </Section>
  );
}

function FeedbackSection() {
  const { activeStudioId } = useDashboardSession();
  const { data, loading, error } = useBff<FeedbackSettingsDTO>(`studios/${activeStudioId}/feedback-settings`, activeStudioId);
  const { form, setForm, saving, error: saveError, saved, save } = useSave<FeedbackSettingsDTO>(activeStudioId, `studios/${activeStudioId}/feedback-settings`, data);
  const [urlError, setUrlError] = useState<string | null>(null);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!form) return null;

  const doSave = () => {
    setUrlError(null);
    if (form.googleReviewUrl) {
      const check = validateGoogleReviewUrl(form.googleReviewUrl);
      if (!check.valid) {
        setUrlError(check.error);
        return;
      }
    }
    save(form);
  };

  return (
    <Section title="Geri bildirim ve tavsiye" description="Google yorum yönlendirmesi ve arkadaşını getir ödül birimi">
      <div className="max-w-lg space-y-3">
        <TextField
          label="Google yorum bağlantısı"
          value={form.googleReviewUrl ?? ''}
          onChange={(v) => setForm({ ...form, googleReviewUrl: v || null })}
          placeholder="https://g.page/..."
          error={urlError}
        />
        <label className="block text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          Tavsiye ödül birimi
          <input
            type="number"
            min={0}
            max={50}
            value={form.referralRewardUnits}
            onChange={(e) => setForm({ ...form, referralRewardUnits: Number(e.target.value) })}
            className="w-full mt-1 px-2 py-1.5 border text-sm"
            style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-input)', backgroundColor: 'var(--color-background)', color: 'var(--color-text-primary)' }}
          />
        </label>
      </div>
      {saveError && <InlineMessage text={saveError} tone="error" />}
      {saved && <InlineMessage text="Kaydedildi" tone="success" />}
      <PrimaryButton onClick={doSave} disabled={saving}>
        {saving ? 'Kaydediliyor...' : 'Kaydet'}
      </PrimaryButton>
    </Section>
  );
}

function EmbedOriginsSection() {
  const { activeStudioId } = useDashboardSession();
  const { data, loading, error: loadError } = useBff<{ id: string; embedAllowedOrigins: string[] }>(
    `studios/${activeStudioId}/embed-settings`,
    activeStudioId,
  );
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
    const check = validateEmbedOrigin(v);
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
      setSaveError(err instanceof BffError ? err.message : 'Kaydedilemedi');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title="Gömülü widget izinli kökenler" description="Boş bırakılırsa rezervasyon widget'ı her kökenden çerçevelenebilir">
      {loading && <LoadingState />}
      {loadError && <InlineMessage text="Mevcut liste yüklenemedi" tone="error" />}
      <div className="flex gap-2 max-w-lg">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="https://ornek.com"
          className="flex-1 px-3 py-2 text-sm border"
          style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-input)', backgroundColor: 'var(--color-background)', color: 'var(--color-text-primary)' }}
        />
        <PrimaryButton onClick={add}>Ekle</PrimaryButton>
      </div>
      {draftError && <InlineMessage text={draftError} tone="error" />}
      {origins.length > 0 && (
        <ul className="text-sm space-y-1" style={{ color: 'var(--color-text-primary)' }}>
          {origins.map((o) => (
            <li key={o} className="flex items-center justify-between">
              {o}
              <button type="button" className="text-xs underline" onClick={() => setOrigins((prev) => prev.filter((x) => x !== o))}>
                kaldır
              </button>
            </li>
          ))}
        </ul>
      )}
      {saveError && <InlineMessage text={saveError} tone="error" />}
      {saved && <InlineMessage text="Kaydedildi" tone="success" />}
      <PrimaryButton onClick={doSave} disabled={saving}>
        {saving ? 'Kaydediliyor...' : 'Kaydet'}
      </PrimaryButton>
    </Section>
  );
}

function BusinessSettings() {
  const { permissions, isOwner } = useDashboardSession();
  const canCatalog = hasAnyPermission(['catalog.view', 'catalog.manage'], permissions, isOwner);
  const canStudio = hasAnyPermission(['studio.settings.view', 'studio.settings.manage'], permissions, isOwner);
  const canNotify = hasAnyPermission(['notifications.manage'], permissions, isOwner);
  const canGamify = hasAnyPermission(['reports.view', 'studio.settings.manage'], permissions, isOwner);
  const canIntegrations = hasAnyPermission(['integrations.manage'], permissions, isOwner);

  return (
    <div className="space-y-6">
      <SettingsHeader title="İşletme" description="İptal politikası, check-in, bildirim, oyunlaştırma ve geri bildirim ayarları" />
      {canCatalog && <CancellationPolicySection />}
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
