'use client';

import { useEffect, useState } from 'react';
import { LeadStage } from '@platform/shared';
import type { LeadDTO, LeadDetailDTO, LeadListResponseDTO } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { bffFetch, BffError } from '@/lib/session/client';
import { PageGuard } from '@/components/common/PageGuard';
import { PermissionButton } from '@/components/common/PermissionButton';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { LeadDetailDrawer } from '@/components/leads/LeadDetailDrawer';
import { NewLeadDialog } from '@/components/leads/NewLeadDialog';
import { PageHeader } from '@/components/ui/PageHeader';

const STAGES: LeadStage[] = [LeadStage.NEW, LeadStage.CONTACTED, LeadStage.TRIAL_BOOKED, LeadStage.TRIAL_DONE, LeadStage.WON, LeadStage.LOST];

function LeadsBoard() {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const columns = STAGES.map((stage) => ({ stage, label: t(`leads.stage.${stage}`) }));
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
      .catch((err) => setError(err instanceof BffError ? err.message : t('leads.errors.loadFailed')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStudioId, reloadKey]);

  async function openLead(leadId: string) {
    if (!activeStudioId) return;
    try {
      const detail = await bffFetch<LeadDetailDTO>(`leads/${leadId}/studio/${activeStudioId}`, { studioId: activeStudioId });
      setSelectedLead(detail);
    } catch (err) {
      window.alert(err instanceof BffError ? err.message : t('leads.errors.detailLoadFailed'));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('leads.title')}
        description={t('leads.subtitle')}
        actions={
          <PermissionButton required={['leads.manage']} variant="primary" onClick={() => setShowNew(true)}>
            {t('leads.new')}
          </PermissionButton>
        }
      />

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!leads || leads.length === 0) && <EmptyState title={t('leads.empty')} />}

      {!loading && !error && leads && leads.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          {columns.map((col) => {
            const items = leads.filter((l) => l.stage === col.stage);
            return (
              <div key={col.stage} className="space-y-2">
                <div className="flex items-center justify-between px-1 ui-strong ui-caption">
                  <span>{col.label}</span>
                  <span>{items.length}</span>
                </div>
                <div className="space-y-2 min-h-[60px]">
                  {items.map((lead) => (
                    <button
                      key={lead.id}
                      type="button"
                      onClick={() => openLead(lead.id)}
                      className="w-full text-left p-3 pui-card"
                    >
                      <div className="ui-strong">
                        {lead.fullName}
                      </div>
                      <div className="mt-0.5 ui-caption">
                        {lead.phone}
                      </div>
                      {lead.ownerName && (
                        <div className="mt-1 ui-caption">
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
