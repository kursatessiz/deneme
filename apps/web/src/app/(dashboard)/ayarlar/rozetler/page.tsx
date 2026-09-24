'use client';

import { useState } from 'react';
import { BadgeKind } from '@platform/shared';
import type { BadgeDefinitionDTO, BadgeThresholdParams } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { PageGuard } from '@/components/common/PageGuard';
import { hasAnyPermission } from '@/lib/nav';
import { Badge, InlineMessage, PrimaryButton, SecondaryButton, Section, SettingsHeader, TextField, Toggle } from '@/components/settings/ui';
import { BADGE_KIND_LABELS, defaultThresholdFor, describeThreshold } from '@/lib/settings/badge-threshold';

function ThresholdFields({
  threshold,
  onChange,
}: {
  threshold: BadgeThresholdParams;
  onChange: (t: BadgeThresholdParams) => void;
}) {
  switch (threshold.kind) {
    case BadgeKind.MILESTONE_SESSIONS:
      return (
        <TextField
          label="Seans sayısı"
          type="number"
          value={String(threshold.sessions)}
          onChange={(v) => onChange({ ...threshold, sessions: Number(v) || 0 })}
        />
      );
    case BadgeKind.STREAK_WEEKS:
      return (
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Hafta sayısı"
            type="number"
            value={String(threshold.weeks)}
            onChange={(v) => onChange({ ...threshold, weeks: Number(v) || 0 })}
          />
          <TextField
            label="Haftada en az seans"
            type="number"
            value={String(threshold.minSessionsPerWeek)}
            onChange={(v) => onChange({ ...threshold, minSessionsPerWeek: Number(v) || 0 })}
          />
        </div>
      );
    case BadgeKind.EARLY_BIRD:
      return (
        <TextField
          label="Saatten önce (0-23)"
          type="number"
          value={String(threshold.beforeHour)}
          onChange={(v) => onChange({ ...threshold, beforeHour: Math.min(23, Math.max(0, Number(v) || 0)) })}
        />
      );
    case BadgeKind.VARIETY:
      return (
        <TextField
          label="Farklı hizmet türü sayısı"
          type="number"
          value={String(threshold.distinctServiceTypes)}
          onChange={(v) => onChange({ ...threshold, distinctServiceTypes: Number(v) || 0 })}
        />
      );
    case BadgeKind.MONTHLY_GOAL_MET:
    case BadgeKind.FIRST_SESSION:
      return null;
    default:
      return null;
  }
}

function BadgeEditor({
  badge,
  onCancel,
  onSaved,
}: {
  badge: BadgeDefinitionDTO | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { activeStudioId } = useDashboardSession();
  const [key, setKey] = useState(badge?.key ?? '');
  const [name, setName] = useState(badge?.name ?? '');
  const [description, setDescription] = useState(badge?.description ?? '');
  const [kind, setKind] = useState<BadgeKind>(badge?.kind ?? BadgeKind.MILESTONE_SESSIONS);
  const [threshold, setThreshold] = useState<BadgeThresholdParams>(badge?.threshold ?? defaultThresholdFor(BadgeKind.MILESTONE_SESSIONS));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changeKind = (next: BadgeKind) => {
    setKind(next);
    setThreshold(defaultThresholdFor(next));
  };

  const save = async () => {
    setError(null);
    if (!badge && !/^[a-z0-9][a-z0-9-]{1,59}$/.test(key)) {
      setError('Anahtar küçük harf, rakam ve tire içermelidir (ör. hosgeldin-rozeti)');
      return;
    }
    if (name.trim().length < 2) {
      setError('Ad en az 2 karakter olmalıdır');
      return;
    }
    setSaving(true);
    try {
      if (badge) {
        await bffFetch(`gamification/studio/${activeStudioId}/badge-definitions/${badge.id}`, {
          method: 'PUT',
          body: { name, description: description || '', threshold },
          studioId: activeStudioId,
        });
      } else {
        await bffFetch(`gamification/studio/${activeStudioId}/badge-definitions`, {
          method: 'POST',
          body: { key, name, description: description || '', kind, threshold, isActive: true },
          studioId: activeStudioId,
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof BffError ? err.message : 'Rozet kaydedilemedi');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title={badge ? `"${badge.name}" rozetini düzenle` : 'Yeni rozet'} description="Rozetin türünü, adını ve eşik değerlerini belirleyin">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
        {!badge && <TextField label="Anahtar" value={key} onChange={setKey} placeholder="ornek-rozet" />}
        <TextField label="Ad" value={name} onChange={setName} placeholder="Örn. 10 Seans Tamamlandı" />
      </div>
      <div className="max-w-xl">
        <TextField label="Açıklama" value={description} onChange={setDescription} placeholder="Üyeye gösterilecek kısa açıklama (opsiyonel)" />
      </div>
      {!badge && (
        <label className="block space-y-1 max-w-xs">
          <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            Rozet türü
          </span>
          <select
            value={kind}
            onChange={(e) => changeKind(e.target.value as BadgeKind)}
            className="w-full px-3 py-2 text-sm border"
            style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-input)', backgroundColor: 'var(--color-background)', color: 'var(--color-text-primary)' }}
          >
            {Object.values(BadgeKind).map((k) => (
              <option key={k} value={k}>
                {BADGE_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="max-w-xl">
        <ThresholdFields threshold={threshold} onChange={setThreshold} />
      </div>
      {error && <InlineMessage text={error} tone="error" />}
      <div className="flex gap-2">
        <PrimaryButton onClick={save} disabled={saving}>
          {saving ? 'Kaydediliyor...' : 'Kaydet'}
        </PrimaryButton>
        <SecondaryButton onClick={onCancel} disabled={saving}>
          Vazgeç
        </SecondaryButton>
      </div>
    </Section>
  );
}

function BadgeCard({
  badge,
  canEdit,
  onEdit,
  onToggleActive,
  onDelete,
}: {
  badge: BadgeDefinitionDTO;
  canEdit: boolean;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  const isGlobal = badge.studioId === null;
  return (
    <div
      className="p-5 border flex flex-col gap-3"
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-card)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {badge.name}
        </h3>
        <div className="flex items-center gap-1.5">
          {isGlobal && <Badge tone="primary">Küresel -- salt okunur</Badge>}
          {!badge.isActive && <Badge tone="neutral">Pasif</Badge>}
        </div>
      </div>
      {badge.description && (
        <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          {badge.description}
        </p>
      )}
      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        {BADGE_KIND_LABELS[badge.kind]} - {describeThreshold(badge.threshold)}
      </p>
      {canEdit && !isGlobal && (
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Toggle label="Etkin" checked={badge.isActive} onChange={onToggleActive} />
          <SecondaryButton onClick={onEdit}>Düzenle</SecondaryButton>
          <SecondaryButton danger onClick={onDelete}>
            Sil
          </SecondaryButton>
        </div>
      )}
    </div>
  );
}

function BadgeDefinitions() {
  const { activeStudioId, permissions, isOwner } = useDashboardSession();
  const canEdit = hasAnyPermission(['studio.settings.manage'], permissions, isOwner);
  const { data: badges, loading, error, forbidden } = useBff<BadgeDefinitionDTO[]>(
    `gamification/studio/${activeStudioId}/badge-definitions`,
    activeStudioId,
  );
  const [editing, setEditing] = useState<BadgeDefinitionDTO | null | 'new'>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = () => setRefreshKey((k) => k + 1);

  const toggleActive = async (badge: BadgeDefinitionDTO) => {
    setActionError(null);
    try {
      await bffFetch(`gamification/studio/${activeStudioId}/badge-definitions/${badge.id}`, {
        method: 'PUT',
        body: { isActive: !badge.isActive },
        studioId: activeStudioId,
      });
      refresh();
    } catch (err) {
      setActionError(err instanceof BffError ? err.message : 'Durum güncellenemedi');
    }
  };

  const remove = async (badge: BadgeDefinitionDTO) => {
    setActionError(null);
    try {
      await bffFetch(`gamification/studio/${activeStudioId}/badge-definitions/${badge.id}`, { method: 'DELETE', studioId: activeStudioId });
      refresh();
    } catch (err) {
      setActionError(err instanceof BffError ? err.message : 'Rozet silinemedi (kazanılmış rozetler yerine pasif hale getirilir)');
    }
  };

  if (forbidden) return <ErrorState message="Bu sayfayı görüntüleme yetkiniz yok" />;

  const globalBadges = (badges ?? []).filter((b) => b.studioId === null);
  const studioBadges = (badges ?? []).filter((b) => b.studioId !== null);

  return (
    <div className="space-y-6" key={refreshKey}>
      <div className="flex items-center justify-between">
        <SettingsHeader title="Rozetler" description="Küresel ve işletmenize özel oyunlaştırma rozetleri" />
        {canEdit && editing === null && <PrimaryButton onClick={() => setEditing('new')}>Yeni rozet</PrimaryButton>}
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {actionError && <InlineMessage text={actionError} tone="error" />}

      {editing === 'new' && (
        <BadgeEditor badge={null} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />
      )}
      {editing && editing !== 'new' && (
        <BadgeEditor badge={editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />
      )}

      {!loading && !error && editing === null && (
        <>
          {(badges ?? []).length === 0 && <EmptyState title="Rozet bulunamadı" description="Henüz tanımlı rozet yok." />}

          {studioBadges.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-text-muted)' }}>
                İşletmenize özel
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {studioBadges.map((b) => (
                  <BadgeCard
                    key={b.id}
                    badge={b}
                    canEdit={canEdit}
                    onEdit={() => setEditing(b)}
                    onToggleActive={() => toggleActive(b)}
                    onDelete={() => remove(b)}
                  />
                ))}
              </div>
            </div>
          )}

          {globalBadges.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-text-muted)' }}>
                Küresel varsayılanlar
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {globalBadges.map((b) => (
                  <BadgeCard key={b.id} badge={b} canEdit={canEdit} onEdit={() => {}} onToggleActive={() => {}} onDelete={() => {}} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function BadgeDefinitionsPage() {
  return (
    <PageGuard required={['reports.view', 'studio.settings.manage']}>
      <BadgeDefinitions />
    </PageGuard>
  );
}
