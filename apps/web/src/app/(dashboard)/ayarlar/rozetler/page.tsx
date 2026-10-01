'use client';

import { useState } from 'react';
import { BadgeKind } from '@platform/shared';
import type { BadgeDefinitionDTO, BadgeThresholdParams } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { PageGuard } from '@/components/common/PageGuard';
import { hasAnyPermission } from '@/lib/nav';
import { Badge, InlineMessage, PrimaryButton, SecondaryButton, Section, SettingsHeader, TextField, Toggle } from '@/components/settings/ui';
import { badgeKindLabel, defaultThresholdFor, describeThreshold } from '@/lib/settings/badge-threshold';
import { Select } from '@/components/ui/Select';
import { Card } from '@/components/ui/Card';
import { FieldGroup } from '@/components/ui/FieldGroup';

function ThresholdFields({ threshold, onChange }: { threshold: BadgeThresholdParams; onChange: (t: BadgeThresholdParams) => void }) {
  const t = useT();
  switch (threshold.kind) {
    case BadgeKind.MILESTONE_SESSIONS:
      return (
        <TextField
          label={t('settings.badges.fields.sessionCount')}
          type="number"
          value={String(threshold.sessions)}
          onChange={(v) => onChange({ ...threshold, sessions: Number(v) || 0 })}
        />
      );
    case BadgeKind.STREAK_WEEKS:
      return (
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label={t('settings.badges.fields.weekCount')}
            type="number"
            value={String(threshold.weeks)}
            onChange={(v) => onChange({ ...threshold, weeks: Number(v) || 0 })}
          />
          <TextField
            label={t('settings.badges.fields.minSessionsPerWeek')}
            type="number"
            value={String(threshold.minSessionsPerWeek)}
            onChange={(v) => onChange({ ...threshold, minSessionsPerWeek: Number(v) || 0 })}
          />
        </div>
      );
    case BadgeKind.EARLY_BIRD:
      return (
        <TextField
          label={t('settings.badges.fields.beforeHour')}
          type="number"
          value={String(threshold.beforeHour)}
          onChange={(v) => onChange({ ...threshold, beforeHour: Math.min(23, Math.max(0, Number(v) || 0)) })}
        />
      );
    case BadgeKind.VARIETY:
      return (
        <TextField
          label={t('settings.badges.fields.distinctServiceTypes')}
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

function BadgeEditor({ badge, onCancel, onSaved }: { badge: BadgeDefinitionDTO | null; onCancel: () => void; onSaved: () => void }) {
  const t = useT();
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
      setError(t('settings.badges.keyFormatError'));
      return;
    }
    if (name.trim().length < 2) {
      setError(t('settings.badges.nameTooShort'));
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
      setError(err instanceof BffError ? err.message : t('settings.badges.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      title={badge ? t('settings.badges.editTitle', { name: badge.name }) : t('settings.badges.newTitle')}
      description={t('settings.badges.editDescription')}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
        {!badge && <TextField label={t('settings.badges.keyLabel')} value={key} onChange={setKey} placeholder={t('settings.badges.keyPlaceholder')} />}
        <TextField label={t('settings.badges.nameLabel')} value={name} onChange={setName} placeholder={t('settings.badges.namePlaceholder')} />
      </div>
      <div className="max-w-xl">
        <TextField
          label={t('settings.badges.descriptionLabel')}
          value={description}
          onChange={setDescription}
          placeholder={t('settings.badges.descriptionPlaceholder')}
        />
      </div>
      {!badge && (
        <FieldGroup label={t('settings.badges.kindLabel')} className="max-w-xs">
          <Select value={kind} onChange={(e) => changeKind(e.target.value as BadgeKind)}>
            {Object.values(BadgeKind).map((k) => (
              <option key={k} value={k}>
                {badgeKindLabel(t, k)}
              </option>
            ))}
          </Select>
        </FieldGroup>
      )}
      <div className="max-w-xl">
        <ThresholdFields threshold={threshold} onChange={setThreshold} />
      </div>
      {error && <InlineMessage text={error} tone="error" />}
      <div className="flex gap-2">
        <PrimaryButton onClick={save} disabled={saving}>
          {saving ? t('common.saving') : t('common.save')}
        </PrimaryButton>
        <SecondaryButton onClick={onCancel} disabled={saving}>
          {t('common.cancel')}
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
  const t = useT();
  const isGlobal = badge.studioId === null;
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="ui-heading">{badge.name}</h3>
        <div className="flex items-center gap-1.5">
          {isGlobal && <Badge tone="primary">{t('settings.badges.global')}</Badge>}
          {!badge.isActive && <Badge tone="neutral">{t('settings.badges.inactive')}</Badge>}
        </div>
      </div>
      {badge.description && <p className="ui-caption">{badge.description}</p>}
      <p className="ui-caption">
        {badgeKindLabel(t, badge.kind)} - {describeThreshold(t, badge.threshold)}
      </p>
      {canEdit && !isGlobal && (
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Toggle label={t('settings.badges.activeToggle')} checked={badge.isActive} onChange={onToggleActive} />
          <SecondaryButton onClick={onEdit}>{t('settings.badges.edit')}</SecondaryButton>
          <SecondaryButton danger onClick={onDelete}>
            {t('settings.badges.delete')}
          </SecondaryButton>
        </div>
      )}
    </Card>
  );
}

function BadgeDefinitions() {
  const t = useT();
  const { activeStudioId, permissions, isOwner } = useDashboardSession();
  const canEdit = hasAnyPermission(['studio.settings.manage'], permissions, isOwner);
  const { data: badges, loading, error, forbidden } = useBff<BadgeDefinitionDTO[]>(`gamification/studio/${activeStudioId}/badge-definitions`, activeStudioId);
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
      setActionError(err instanceof BffError ? err.message : t('settings.badges.errors.statusUpdateFailed'));
    }
  };

  const remove = async (badge: BadgeDefinitionDTO) => {
    setActionError(null);
    try {
      await bffFetch(`gamification/studio/${activeStudioId}/badge-definitions/${badge.id}`, { method: 'DELETE', studioId: activeStudioId });
      refresh();
    } catch (err) {
      setActionError(err instanceof BffError ? err.message : t('settings.badges.errors.deleteFailed'));
    }
  };

  if (forbidden) return <ErrorState message={t('settings.badges.forbidden')} />;

  const globalBadges = (badges ?? []).filter((b) => b.studioId === null);
  const studioBadges = (badges ?? []).filter((b) => b.studioId !== null);

  return (
    <div className="space-y-6" key={refreshKey}>
      <div className="flex items-center justify-between">
        <SettingsHeader title={t('settings.badges.title')} description={t('settings.badges.description')} />
        {canEdit && editing === null && <PrimaryButton onClick={() => setEditing('new')}>{t('settings.badges.new')}</PrimaryButton>}
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {actionError && <InlineMessage text={actionError} tone="error" />}

      {editing === 'new' && (
        <BadgeEditor
          badge={null}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
      {editing && editing !== 'new' && (
        <BadgeEditor
          badge={editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}

      {!loading && !error && editing === null && (
        <>
          {(badges ?? []).length === 0 && <EmptyState title={t('settings.badges.empty.title')} description={t('settings.badges.empty.description')} />}

          {studioBadges.length > 0 && (
            <div>
              <h4 className="ui-caption ui-strong uppercase mb-2">{t('settings.badges.studioSection')}</h4>
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
              <h4 className="ui-caption ui-strong uppercase mb-2">{t('settings.badges.globalSection')}</h4>
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
