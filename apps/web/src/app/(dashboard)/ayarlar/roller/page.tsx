'use client';

import { useMemo, useState } from 'react';
import type { PermissionKey, RoleTemplateDTO, StaffMembershipDTO } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { PageGuard } from '@/components/common/PageGuard';
import { Badge, InlineMessage, PrimaryButton, SecondaryButton, Section, SettingsHeader, TextField } from '@/components/settings/ui';
import { groupPermissionsByArea } from '@/lib/settings/role-permission-grouping';

const AREA_GROUPS = groupPermissionsByArea();

function RoleEditor({
  role,
  onCancel,
  onSaved,
}: {
  role: RoleTemplateDTO | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { activeStudioId } = useDashboardSession();
  const [name, setName] = useState(role?.name ?? '');
  const [selected, setSelected] = useState<Set<PermissionKey>>(new Set((role?.permissions ?? []) as PermissionKey[]));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (key: PermissionKey) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const save = async () => {
    setError(null);
    if (name.trim().length < 2) {
      setError('Rol adı en az 2 karakter olmalıdır');
      return;
    }
    setSaving(true);
    try {
      const permissions = [...selected];
      if (role) {
        await bffFetch(`role-templates/${role.id}`, { method: 'PUT', body: { name, permissions }, studioId: activeStudioId });
      } else {
        await bffFetch('role-templates', { method: 'POST', body: { studioId: activeStudioId, name, permissions }, studioId: activeStudioId });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof BffError ? err.message : 'Rol kaydedilemedi');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title={role ? `"${role.name}" rolünü düzenle` : 'Yeni rol'} description="İzin kataloğundan bu role vereceğiniz yetkileri seçin">
      <div className="max-w-sm">
        <TextField label="Rol adı" value={name} onChange={setName} placeholder="Örn. Kıdemli Resepsiyon" />
      </div>
      <div className="space-y-4">
        {AREA_GROUPS.map((group) => (
          <div key={group.area}>
            <h4 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-text-muted)' }}>
              {group.area}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
              {group.permissions.map((p) => (
                <label key={p.key} className="flex items-start gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text-primary)' }}>
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={selected.has(p.key)}
                    onChange={() => toggle(p.key)}
                  />
                  <span>{p.label}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
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

function RolesAndStaff() {
  const { activeStudioId } = useDashboardSession();
  const { data: roles, loading, error, forbidden } = useBff<RoleTemplateDTO[]>(`role-templates/studio/${activeStudioId}`, activeStudioId);
  const {
    data: staff,
    loading: staffLoading,
    error: staffError,
  } = useBff<StaffMembershipDTO[]>(`role-templates/studio/${activeStudioId}/staff`, activeStudioId);

  const [editing, setEditing] = useState<RoleTemplateDTO | null | 'new'>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);

  const assignableRoles = useMemo(() => (roles ?? []).filter((r) => !r.isOwner), [roles]);

  const assignRole = async (membershipId: string, roleTemplateId: string) => {
    setAssignError(null);
    setAssigningId(membershipId);
    try {
      await bffFetch(`role-templates/staff/${membershipId}`, { method: 'PUT', body: { roleTemplateId }, studioId: activeStudioId });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setAssignError(err instanceof BffError ? err.message : 'Rol ataması yapılamadı');
    } finally {
      setAssigningId(null);
    }
  };

  const deleteRole = async (id: string) => {
    setDeleteError(null);
    try {
      await bffFetch(`role-templates/${id}`, { method: 'DELETE', studioId: activeStudioId });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setDeleteError(err instanceof BffError ? err.message : 'Rol silinemedi');
    }
  };

  if (forbidden) return <ErrorState message="Bu sayfayı görüntüleme yetkiniz yok" />;

  return (
    <div className="space-y-6" key={refreshKey}>
      <div className="flex items-center justify-between">
        <SettingsHeader title="Roller ve yetkiler" description="Rol tanımları, izin kümeleri ve personel rol ataması" />
        {editing === null && <PrimaryButton onClick={() => setEditing('new')}>Yeni rol</PrimaryButton>}
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}

      {editing === 'new' && <RoleEditor role={null} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); setRefreshKey((k) => k + 1); }} />}
      {editing && editing !== 'new' && (
        <RoleEditor role={editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); setRefreshKey((k) => k + 1); }} />
      )}

      {!loading && !error && editing === null && (
        <>
          {deleteError && <InlineMessage text={deleteError} tone="error" />}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(roles ?? []).map((role) => (
              <div
                key={role.id}
                className="p-5 border flex flex-col gap-3"
                style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-card)' }}
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    {role.name}
                  </h3>
                  {role.isOwner && <Badge tone="primary">İşletme sahibi -- salt okunur</Badge>}
                </div>
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {role.isOwner ? 'Her zaman tüm izinlere sahiptir' : `${role.permissions.length} izin`}
                </p>
                {!role.isOwner && (
                  <div className="flex gap-2">
                    <SecondaryButton onClick={() => setEditing(role)}>Düzenle</SecondaryButton>
                    <SecondaryButton danger onClick={() => deleteRole(role.id)}>
                      Sil
                    </SecondaryButton>
                  </div>
                )}
              </div>
            ))}
          </div>

          <Section title="Personel rol ataması" description="Personelin rolünü değiştirin; işletme sahibinin rolü değiştirilemez">
            {staffLoading && <LoadingState />}
            {staffError && <ErrorState message={staffError} />}
            {assignError && <InlineMessage text={assignError} tone="error" />}
            {!staffLoading && !staffError && (!staff || staff.length === 0) && (
              <EmptyState title="Henüz personel yok" description="Personel davet edildikçe burada listelenecek." />
            )}
            {!staffLoading && !staffError && staff && staff.length > 0 && (
              <div className="space-y-2">
                {staff.map((m) => (
                  <div key={m.membershipId} className="flex items-center justify-between gap-3 py-2 border-b last:border-b-0" style={{ borderColor: 'var(--color-border)' }}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>
                        {m.fullName}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        {m.phone}
                      </p>
                    </div>
                    {m.isOwner ? (
                      <Badge tone="primary">İşletme sahibi</Badge>
                    ) : (
                      <select
                        value={m.roleTemplateId}
                        disabled={assigningId === m.membershipId}
                        onChange={(e) => assignRole(m.membershipId, e.target.value)}
                        className="text-sm px-2 py-1.5 border"
                        style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-input)', backgroundColor: 'var(--color-background)', color: 'var(--color-text-primary)' }}
                      >
                        {assignableRoles.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

export default function RolesPage() {
  return (
    <PageGuard required={['roles.manage']}>
      <RolesAndStaff />
    </PageGuard>
  );
}
