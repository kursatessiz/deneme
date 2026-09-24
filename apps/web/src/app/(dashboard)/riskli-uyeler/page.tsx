'use client';

import { useEffect, useState } from 'react';
import type { ChurnListResponseDTO, ChurnMemberSummaryDTO, ChurnRiskLevel, ChurnSummaryDTO } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { bffFetch, BffError } from '@/lib/session/client';
import { PageGuard } from '@/components/common/PageGuard';
import { PermissionButton } from '@/components/common/PermissionButton';
import { Badge } from '@/components/common/Badge';
import { Modal } from '@/components/common/Modal';
import { BranchSelect } from '@/components/common/BranchSelect';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { ChurnSummaryTiles } from '@/components/churn/ChurnSummaryTiles';

const LEVEL_LABEL: Record<string, string> = { HIGH: 'Yüksek', MEDIUM: 'Orta', LOW: 'Düşük' };
const LEVEL_TONE: Record<string, 'danger' | 'warning' | 'neutral'> = { HIGH: 'danger', MEDIUM: 'warning', LOW: 'neutral' };

const selectStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};

function ContactedDialog({ studioId, member, onClose, onDone }: { studioId: string; member: ChurnMemberSummaryDTO; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) {
      setError('Not giriniz');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await bffFetch(`churn/studio/${studioId}/members/${member.memberId}/contacted`, { method: 'POST', studioId, body: { note: note.trim() } });
      onDone();
    } catch (err) {
      setError(err instanceof BffError ? err.message : 'İşlenemedi');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`${member.firstName} ${member.lastName} - Görüşüldü`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <textarea placeholder="Görüşme notu" value={note} onChange={(e) => setNote(e.target.value)} className="w-full text-sm px-3 py-1.5" style={{ ...selectStyle, minHeight: 70 }} />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <PermissionButton type="button" variant="ghost" onClick={onClose}>
            Vazgeç
          </PermissionButton>
          <PermissionButton required={['members.manage']} type="submit" variant="primary" disabled={submitting}>
            {submitting ? 'Kaydediliyor...' : 'Kaydet'}
          </PermissionButton>
        </div>
      </form>
    </Modal>
  );
}

function ChurnList() {
  const { activeStudioId } = useDashboardSession();
  const [level, setLevel] = useState<ChurnRiskLevel | ''>('');
  const [branchId, setBranchId] = useState('');
  const [includeSnoozed, setIncludeSnoozed] = useState(false);
  const [search, setSearch] = useState('');
  const [members, setMembers] = useState<ChurnMemberSummaryDTO[] | null>(null);
  const [summary, setSummary] = useState<ChurnSummaryDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contactingMember, setContactingMember] = useState<ChurnMemberSummaryDTO | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!activeStudioId) return;
    bffFetch<ChurnSummaryDTO>(`churn/studio/${activeStudioId}/summary`, { studioId: activeStudioId })
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [activeStudioId, reloadKey]);

  useEffect(() => {
    if (!activeStudioId) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (level) params.set('level', level);
    if (branchId) params.set('branchId', branchId);
    if (includeSnoozed) params.set('includeSnoozed', 'true');
    if (search.trim()) params.set('search', search.trim());
    params.set('limit', '50');
    const timer = setTimeout(() => {
      bffFetch<ChurnListResponseDTO>(`churn/studio/${activeStudioId}/members?${params.toString()}`, { studioId: activeStudioId })
        .then((res) => setMembers(res.items))
        .catch((err) => setError(err instanceof BffError ? err.message : 'Riskli üyeler yüklenemedi'))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [activeStudioId, level, branchId, includeSnoozed, search, reloadKey]);

  async function handleSnooze(member: ChurnMemberSummaryDTO, days: number) {
    if (!activeStudioId) return;
    try {
      await bffFetch(`churn/studio/${activeStudioId}/members/${member.memberId}/snooze`, { method: 'POST', studioId: activeStudioId, body: { days } });
      setReloadKey((k) => k + 1);
    } catch (err) {
      window.alert(err instanceof BffError ? err.message : 'Ertelenemedi');
    }
  }

  async function handleRecompute() {
    if (!activeStudioId) return;
    try {
      await bffFetch(`churn/studio/${activeStudioId}/recompute`, { method: 'POST', studioId: activeStudioId, body: {} });
      setReloadKey((k) => k + 1);
    } catch (err) {
      window.alert(err instanceof BffError ? err.message : 'Yeniden hesaplanamadı');
    }
  }

  const exportHref = (() => {
    if (!activeStudioId) return '#';
    const params = new URLSearchParams();
    if (level) params.set('level', level);
    if (branchId) params.set('branchId', branchId);
    if (includeSnoozed) params.set('includeSnoozed', 'true');
    params.set('format', 'csv');
    return `/api/bff/churn/studio/${activeStudioId}/members?${params.toString()}`;
  })();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
            Riskli üyeler
          </h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            Ayrılma riski yüksek üyeler ve nedenleri
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href={exportHref} className="text-xs font-medium px-3 py-1.5" style={{ ...selectStyle, background: 'var(--color-surface-muted)' }}>
            CSV indir
          </a>
          <PermissionButton required={['members.manage']} onClick={handleRecompute}>
            Yeniden hesapla
          </PermissionButton>
        </div>
      </div>

      {summary && <ChurnSummaryTiles summary={summary} />}

      <div className="flex flex-wrap items-center gap-2">
        <input
          placeholder="Ad, soyad ara..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="text-sm px-3 py-1.5 flex-1 min-w-[200px]"
          style={selectStyle}
        />
        <select value={level} onChange={(e) => setLevel(e.target.value as ChurnRiskLevel | '')} className="text-xs px-2.5 py-1.5" style={selectStyle}>
          <option value="">Tüm seviyeler</option>
          <option value="HIGH">Yüksek</option>
          <option value="MEDIUM">Orta</option>
          <option value="LOW">Düşük</option>
        </select>
        <BranchSelect value={branchId} onChange={setBranchId} />
        <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          <input type="checkbox" checked={includeSnoozed} onChange={(e) => setIncludeSnoozed(e.target.checked)} />
          Ertelenmişleri de göster
        </label>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!members || members.length === 0) && <EmptyState title="Riskli üye bulunamadı" description="Seçili filtrelere uyan üye yok." />}

      {!loading && !error && members && members.length > 0 && (
        <div className="space-y-2">
          {members.map((m) => (
            <div key={m.memberId} className="p-4 flex flex-wrap items-start justify-between gap-3" style={{ borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
              <div>
                <div className="flex items-center gap-2">
                  <a href={`/members/${m.memberId}`} className="font-medium hover:underline" style={{ color: 'var(--color-text-primary)' }}>
                    {m.firstName} {m.lastName}
                  </a>
                  <Badge tone={LEVEL_TONE[m.level]}>{LEVEL_LABEL[m.level]}</Badge>
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    Puan: {m.score}
                    {m.previousScore !== null && m.previousScore !== m.score ? ` (önceki ${m.previousScore})` : ''}
                  </span>
                </div>
                <ul className="text-xs mt-1 space-y-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                  {m.reasons.slice(0, 3).map((r) => (
                    <li key={r.key}>- {r.label}</li>
                  ))}
                </ul>
                {m.contactedAt && (
                  <div className="text-[11px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
                    Son görüşme: {new Date(m.contactedAt).toLocaleDateString('tr-TR')}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <PermissionButton required={['members.manage']} onClick={() => setContactingMember(m)}>
                  Görüşüldü
                </PermissionButton>
                <PermissionButton required={['members.manage']} onClick={() => handleSnooze(m, 14)}>
                  14 gün ertele
                </PermissionButton>
              </div>
            </div>
          ))}
        </div>
      )}

      {contactingMember && activeStudioId && (
        <ContactedDialog
          studioId={activeStudioId}
          member={contactingMember}
          onClose={() => setContactingMember(null)}
          onDone={() => {
            setContactingMember(null);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

export default function Page() {
  return (
    <PageGuard required={['reports.view']}>
      <ChurnList />
    </PageGuard>
  );
}
