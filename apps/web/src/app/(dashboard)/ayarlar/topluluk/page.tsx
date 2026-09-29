'use client';

import { useState } from 'react';
import type { AccessTierDTO, AccessTierRuleInput } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch } from '@/lib/session/client';
import { ErrorState, LoadingState } from '@/components/common/DataState';
import { PageGuard } from '@/components/common/PageGuard';
import { PermissionButton } from '@/components/common/PermissionButton';
import { hasAnyPermission } from '@/lib/nav';
import { InlineMessage, PrimaryButton, SecondaryButton, Section, SettingsHeader, TextField } from '@/components/settings/ui';
import { communityErrorMessage, tierRuleLabel } from '@/components/community/labels';

interface PackageOption {
  id: string;
  name: string;
}

interface TierForm {
  name: string;
  description: string;
  anyMember: boolean;
  anyPackage: boolean;
  packageIds: string[];
}

const EMPTY_FORM: TierForm = { name: '', description: '', anyMember: false, anyPackage: false, packageIds: [] };

function formFrom(tier: AccessTierDTO): TierForm {
  return {
    name: tier.name,
    description: tier.description ?? '',
    anyMember: tier.rules.some((r) => r.kind === 'ACTIVE_MEMBER'),
    anyPackage: tier.rules.some((r) => r.kind === 'ACTIVE_PACKAGE'),
    packageIds: tier.rules.filter((r) => r.kind === 'PACKAGE_DEFINITION' && r.packageDefinitionId).map((r) => r.packageDefinitionId as string),
  };
}

function rulesOf(form: TierForm): AccessTierRuleInput[] {
  const rules: AccessTierRuleInput[] = [];
  if (form.anyMember) rules.push({ kind: 'ACTIVE_MEMBER', packageDefinitionId: null });
  if (form.anyPackage) rules.push({ kind: 'ACTIVE_PACKAGE', packageDefinitionId: null });
  for (const id of form.packageIds) rules.push({ kind: 'PACKAGE_DEFINITION', packageDefinitionId: id });
  return rules;
}

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-primary)' }}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}

function TierEditor({ tier, packages, onDone }: { tier: AccessTierDTO | null; packages: PackageOption[]; onDone: () => void }) {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const [form, setForm] = useState<TierForm>(tier ? formFrom(tier) : EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);

  const save = async () => {
    const rules = rulesOf(form);
    if (rules.length === 0) {
      setMessage({ text: t('community.tiers.needRule'), tone: 'error' });
      return;
    }
    setBusy(true);
    setMessage(null);
    const body = { name: form.name, description: form.description.trim() ? form.description.trim() : null, rules };
    try {
      if (tier) await bffFetch(`studios/${activeStudioId}/community/tiers/${tier.id}`, { method: 'PATCH', studioId: activeStudioId, body });
      else await bffFetch(`studios/${activeStudioId}/community/tiers`, { method: 'POST', studioId: activeStudioId, body });
      if (!tier) setForm(EMPTY_FORM);
      setMessage({ text: t('community.tiers.saved'), tone: 'success' });
      onDone();
    } catch (err) {
      setMessage({ text: communityErrorMessage(err, t), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const togglePackage = (id: string) =>
    setForm((f) => ({ ...f, packageIds: f.packageIds.includes(id) ? f.packageIds.filter((x) => x !== id) : [...f.packageIds, id] }));

  return (
    <Section title={tier ? t('community.tiers.edit') : t('community.tiers.new')}>
      <div className="space-y-3 max-w-xl">
        <TextField label={t('community.tiers.name')} value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
        <TextField label={t('community.tiers.description')} value={form.description} onChange={(v) => setForm({ ...form, description: v })} />
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            {t('community.tiers.rules')}
          </legend>
          <Checkbox label={t('community.tiers.rule.ACTIVE_MEMBER')} checked={form.anyMember} onChange={() => setForm({ ...form, anyMember: !form.anyMember })} />
          <Checkbox label={t('community.tiers.rule.ACTIVE_PACKAGE')} checked={form.anyPackage} onChange={() => setForm({ ...form, anyPackage: !form.anyPackage })} />
          <p className="text-xs pt-1" style={{ color: 'var(--color-text-secondary)' }}>
            {t('community.tiers.packages')}
          </p>
          {packages.length === 0 && <InlineMessage text={t('community.tiers.noPackages')} />}
          <div className="flex flex-wrap gap-3">
            {packages.map((p) => (
              <Checkbox key={p.id} label={p.name} checked={form.packageIds.includes(p.id)} onChange={() => togglePackage(p.id)} />
            ))}
          </div>
          <InlineMessage text={t('community.tiers.rulesHint')} />
        </fieldset>
        {message && <InlineMessage text={message.text} tone={message.tone} />}
        <div className="flex gap-2">
          <PrimaryButton onClick={save} disabled={busy || !form.name.trim()}>
            {t('community.tiers.save')}
          </PrimaryButton>
          {tier && (
            <SecondaryButton onClick={onDone} disabled={busy}>
              {t('community.editor.cancel')}
            </SecondaryButton>
          )}
        </div>
      </div>
    </Section>
  );
}

function AccessTiersView() {
  const t = useT();
  const { activeStudioId, permissions, isOwner } = useDashboardSession();
  const canManage = hasAnyPermission(['community.manage'], permissions, isOwner);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editing, setEditing] = useState<AccessTierDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tiers = useBff<{ items: AccessTierDTO[] }>(activeStudioId ? `studios/${activeStudioId}/community/tiers` : null, activeStudioId, refreshKey);
  const packages = useBff<PackageOption[]>(canManage && activeStudioId ? `catalog/package-definitions/studio/${activeStudioId}` : null, activeStudioId);

  if (tiers.forbidden) return <ErrorState message={t('community.forbidden')} />;
  const refresh = () => setRefreshKey((k) => k + 1);

  const remove = async (tier: AccessTierDTO) => {
    setError(null);
    try {
      await bffFetch(`studios/${activeStudioId}/community/tiers/${tier.id}`, { method: 'DELETE', studioId: activeStudioId });
      if (editing?.id === tier.id) setEditing(null);
      refresh();
    } catch (err) {
      setError(communityErrorMessage(err, t));
    }
  };

  const items = tiers.data?.items ?? [];

  return (
    <div className="space-y-6">
      <SettingsHeader title={t('community.tiers.title')} description={t('community.tiers.subtitle')} />
      <Section title={t('community.tiers.list')}>
        {tiers.loading && !tiers.data && <LoadingState />}
        {tiers.error && <ErrorState message={tiers.error} />}
        {!tiers.loading && items.length === 0 && <InlineMessage text={t('community.tiers.empty')} />}
        <ul className="divide-y" style={{ borderColor: 'var(--color-border)' }} data-testid="community-tiers">
          {items.map((tier) => (
            <li key={tier.id} className="py-2 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                  {tier.name}
                </p>
                {tier.description && (
                  <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    {tier.description}
                  </p>
                )}
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {tier.rules.map((rule) => tierRuleLabel(t, rule)).join(', ')} - {t('community.tiers.postCount', { count: tier.postCount })}
                </p>
              </div>
              <div className="flex gap-2">
                <PermissionButton required={['community.manage']} onClick={() => setEditing(tier)}>
                  {t('community.action.edit')}
                </PermissionButton>
                <PermissionButton required={['community.manage']} variant="danger" onClick={() => remove(tier)}>
                  {t('community.tiers.delete')}
                </PermissionButton>
              </div>
            </li>
          ))}
        </ul>
        {error && <InlineMessage text={error} tone="error" />}
      </Section>
      {canManage && (
        <TierEditor
          key={editing?.id ?? 'new'}
          tier={editing}
          packages={(packages.data ?? []).map((p) => ({ id: p.id, name: p.name }))}
          onDone={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

export default function CommunityTiersPage() {
  return (
    <PageGuard required={['community.view', 'community.manage']}>
      <AccessTiersView />
    </PageGuard>
  );
}
