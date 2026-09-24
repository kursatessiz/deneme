'use client';

import { useEffect, useState } from 'react';
import { LeadStage } from '@platform/shared';
import type { LeadDTO, LeadDetailDTO, LeadListResponseDTO } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { bffFetch, BffError } from '@/lib/session/client';
import { PageGuard } from '@/components/common/PageGuard';
import { PermissionButton } from '@/components/common/PermissionButton';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { LeadDetailDrawer } from '@/components/leads/LeadDetailDrawer';
import { NewLeadDialog } from '@/components/leads/NewLeadDialog';

const COLUMNS: { stage: LeadStage; label: string }[] = [
  { stage: LeadStage.NEW, label: 'Yeni' },
  { stage: LeadStage.CONTACTED, label: 'Görüşüldü' },
  { stage: LeadStage.TRIAL_BOOKED, label: 'Deneme planlandı' },
  { stage: LeadStage.TRIAL_DONE, label: 'Deneme yapıldı' },
  { stage: LeadStage.WON, label: 'Üye oldu' },
  { stage: LeadStage.LOST, label: 'Kaybedildi' },
];

function LeadsBoard() {
  const { activeStudioId } = useDashboardSession();
  const [leads, setLeads] = useState<LeadDTO[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [selectedLead, setSelectedLead] = useState<LeadDetailDTO | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!activeStudioId) return;
    setLoading(true);
    setError(null);
    bffFetch<LeadListResponseDTO>(`leads/studio/${activeStudioId}?limit=100`, { studioId: activeStudioId })
      .then((res) => setLeads(res.items))
      .catch((err) => setError(err instanceof BffError ? err.message : 'Adaylar yüklenemedi'))
      .finally(() => setLoading(false));
  }, [activeStudioId, reloadKey]);

  async function openLead(leadId: string) {
    if (!activeStudioId) return;
    try {
      const detail = await bffFetch<LeadDetailDTO>(`leads/${leadId}/studio/${activeStudioId}`, { studioId: activeStudioId });
      setSelectedLead(detail);
    } catch (err) {
      window.alert(err instanceof BffError ? err.message : 'Aday detayı yüklenemedi');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
            Adaylar
          </h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            Potansiyel müşteri hattı, aşamaya göre
          </p>
        </div>
        <PermissionButton required={['leads.manage']} variant="primary" onClick={() => setShowNew(true)}>
          Yeni aday
        </PermissionButton>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!leads || leads.length === 0) && <EmptyState title="Henüz aday yok" />}

      {!loading && !error && leads && leads.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          {COLUMNS.map((col) => {
            const items = leads.filter((l) => l.stage === col.stage);
            return (
              <div key={col.stage} className="space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold px-1" style={{ color: 'var(--color-text-secondary)' }}>
                  <span>{col.label}</span>
                  <span>{items.length}</span>
                </div>
                <div className="space-y-2 min-h-[60px]">
                  {items.map((lead) => (
                    <button
                      key={lead.id}
                      type="button"
                      onClick={() => openLead(lead.id)}
                      className="w-full text-left p-3 text-sm"
                      style={{ borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}
                    >
                      <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
                        {lead.fullName}
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                        {lead.phone}
                      </div>
                      {lead.ownerName && (
                        <div className="text-[11px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
                          {lead.ownerName}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showNew && activeStudioId && (
        <NewLeadDialog
          studioId={activeStudioId}
          onClose={() => setShowNew(false)}
          onDone={() => {
            setShowNew(false);
            setReloadKey((k) => k + 1);
          }}
        />
      )}

      {selectedLead && activeStudioId && (
        <LeadDetailDrawer
          studioId={activeStudioId}
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onChanged={() => {
            setReloadKey((k) => k + 1);
            openLead(selectedLead.id);
          }}
        />
      )}
    </div>
  );
}

export default function Page() {
  return (
    <PageGuard required={['leads.view']}>
      <LeadsBoard />
    </PageGuard>
  );
}
