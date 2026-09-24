'use client';

import { useState } from 'react';
import type { BranchDTO, BranchSummaryDTO, StaffMembershipDTO } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { PageGuard } from '@/components/common/PageGuard';
import { hasAnyPermission } from '@/lib/nav';
import { Badge, InlineMessage, PrimaryButton, SecondaryButton, Section, SettingsHeader, TextField } from '@/components/settings/ui';

function BranchForm({ branch, onCancel, onSaved }: { branch: BranchDTO | null; onCancel: () => void; onSaved: () => void }) {
  const { activeStudioId } = useDashboardSession();
  const [name, setName] = useState(branch?.name ?? '');
  const [address, setAddress] = useState(branch?.address ?? '');
  const [phone, setPhone] = useState(branch?.phone ?? '');
  const [email, setEmail] = useState(branch?.email ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    if (name.trim().length < 2) {
      setError('Şube adı en az 2 karakter olmalıdır');
      return;
    }
    setSaving(true);
    try {
      const body = { name, address: address || null, phone: phone || null, email: email || null };
      if (branch) {
        await bffFetch(`branches/${branch.id}`, { method: 'PATCH', body, studioId: activeStudioId });
      } else {
        await bffFetch('branches', { method: 'POST', body: { ...body, studioId: activeStudioId, sortOrder: 0 }, studioId: activeStudioId });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof BffError ? err.message : 'Şube kaydedilemedi');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title={branch ? `"${branch.name}" şubesini düzenle` : 'Yeni şube'}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
        <TextField label="Şube adı" value={name} onChange={setName} />
        <TextField label="Telefon" value={phone} onChange={setPhone} />
        <TextField label="E-posta" value={email} onChange={setEmail} />
        <TextField label="Adres" value={address} onChange={setAddress} />
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

function StaffBranchAccess({ studioId, branches }: { studioId: string; branches: BranchDTO[] }) {
  const { data: staff, loading, error } = useBff<StaffMembershipDTO[]>(`role-templates/studio/${studioId}/staff`, studioId);
  const [openMembershipId, setOpenMembershipId] = useState<string | null>(null);
  const [selectedBranchIds, setSelectedBranchIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error2, setError2] = useState<string | null>(null);

  const open = async (membershipId: string) => {
    setError2(null);
    if (openMembershipId === membershipId) {
      setOpenMembershipId(null);
      return;
    }
    try {
      const res = await bffFetch<{ membershipId: string; branchIds: string[] }>(`branches/staff/${membershipId}`, { studioId });
      setSelectedBranchIds(new Set(res.branchIds));
      setOpenMembershipId(membershipId);
    } catch (err) {
      setError2(err instanceof BffError ? err.message : 'Şube erişimi okunamadı');
    }
  };

  const toggle = (branchId: string) => {
    setSelectedBranchIds((prev) => {
      const next = new Set(prev);
      if (next.has(branchId)) next.delete(branchId);
      else next.add(branchId);
      return next;
    });
  };

  const save = async (membershipId: string) => {
    setSaving(true);
    setError2(null);
    try {
      await bffFetch(`branches/staff/${membershipId}`, { method: 'PUT', body: { branchIds: [...selectedBranchIds] }, studioId });
      setOpenMembershipId(null);
    } catch (err) {
      setError2(err instanceof BffError ? err.message : 'Şube erişimi kaydedilemedi');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title="Personelin şube erişimi" description="Hiç kayıt yoksa personel tüm şubelere erişir; işletme sahibi hiçbir zaman kısıtlanamaz">
      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {error2 && <InlineMessage text={error2} tone="error" />}
      {!loading && !error && (!staff || staff.length === 0) && <EmptyState title="Henüz personel yok" />}
      {!loading && !error && staff && staff.length > 0 && (
        <div className="space-y-2">
          {staff.map((m) => (
            <div key={m.membershipId} className="border-b last:border-b-0 py-2" style={{ borderColor: 'var(--color-border)' }}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>
                    {m.fullName}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {m.roleName}
                  </p>
                </div>
                {m.isOwner ? <Badge tone="primary">Kısıtlanamaz</Badge> : <SecondaryButton onClick={() => open(m.membershipId)}>Şube erişimi</SecondaryButton>}
              </div>
              {openMembershipId === m.membershipId && (
                <div className="mt-3 pl-2 space-y-2">
                  <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    Hiçbiri işaretli değilse tüm şubelere erişebilir
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {branches.map((b) => (
                      <label key={b.id} className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-primary)' }}>
                        <input type="checkbox" checked={selectedBranchIds.has(b.id)} onChange={() => toggle(b.id)} />
                        {b.name}
                      </label>
                    ))}
                  </div>
                  <PrimaryButton onClick={() => save(m.membershipId)} disabled={saving}>
                    {saving ? 'Kaydediliyor...' : 'Kaydet'}
                  </PrimaryButton>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function BranchSummaryTable({ studioId }: { studioId: string }) {
  const { data, loading, error } = useBff<BranchSummaryDTO[]>(`branches/studio/${studioId}/summary`, studioId);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!data || data.length === 0) return <EmptyState title="Son 30 günde veri yok" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left" style={{ color: 'var(--color-text-muted)' }}>
            <th className="font-medium py-1.5 pr-4">Şube</th>
            <th className="font-medium py-1.5 pr-4">Seans</th>
            <th className="font-medium py-1.5 pr-4">Doluluk</th>
            <th className="font-medium py-1.5 pr-4">Katılım</th>
            <th className="font-medium py-1.5 pr-4">Gelmeme</th>
            <th className="font-medium py-1.5 pr-4">Gelir</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.branchId ?? 'none'} className="border-t" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }}>
              <td className="py-1.5 pr-4">{row.branchName}</td>
              <td className="py-1.5 pr-4">{row.sessions}</td>
              <td className="py-1.5 pr-4">{Math.round(row.occupancy * 100)}%</td>
              <td className="py-1.5 pr-4">{row.attended}</td>
              <td className="py-1.5 pr-4">{row.noShows}</td>
              <td className="py-1.5 pr-4">{Number(row.revenue).toLocaleString('tr-TR')} TL</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BranchesSettings() {
  const { activeStudioId, permissions, isOwner } = useDashboardSession();
  const canManage = hasAnyPermission(['branches.manage'], permissions, isOwner);
  const canReport = hasAnyPermission(['reports.view'], permissions, isOwner);
  const { data: branches, loading, error } = useBff<BranchDTO[]>(`branches/studio/${activeStudioId}`, activeStudioId);
  const [editing, setEditing] = useState<BranchDTO | null | 'new'>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-6" key={refreshKey}>
      <div className="flex items-center justify-between">
        <SettingsHeader title="Şubeler" description="Şube tanımları ve personelin şube erişimi" />
        {canManage && editing === null && <PrimaryButton onClick={() => setEditing('new')}>Yeni şube</PrimaryButton>}
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}

      {editing === 'new' && <BranchForm branch={null} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); setRefreshKey((k) => k + 1); }} />}
      {editing && editing !== 'new' && (
        <BranchForm branch={editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); setRefreshKey((k) => k + 1); }} />
      )}

      {!loading && !error && editing === null && (
        <>
          {(!branches || branches.length === 0) && <EmptyState title="Henüz şube yok" description="Yeni şube ekleyerek başlayın." />}
          {branches && branches.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {branches.map((b) => (
                <div
                  key={b.id}
                  className="p-5 border flex flex-col gap-2"
                  style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-card)' }}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                      {b.name}
                    </h3>
                    {!b.isActive && <Badge>Pasif</Badge>}
                  </div>
                  <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {b.address || 'Adres eklenmemiş'}
                  </p>
                  {canManage && <SecondaryButton onClick={() => setEditing(b)}>Düzenle</SecondaryButton>}
                </div>
              ))}
            </div>
          )}

          {canManage && branches && <StaffBranchAccess studioId={activeStudioId} branches={branches} />}
          {canReport && (
            <Section title="Şube özeti" description="Son 30 gün">
              <BranchSummaryTable studioId={activeStudioId} />
            </Section>
          )}
        </>
      )}
    </div>
  );
}

export default function BranchesSettingsPage() {
  return (
    <PageGuard required={['branches.manage', 'reports.view']}>
      <BranchesSettings />
    </PageGuard>
  );
}
