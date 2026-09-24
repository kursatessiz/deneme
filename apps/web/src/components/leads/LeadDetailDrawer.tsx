'use client';

import { useEffect, useState } from 'react';
import { LeadStage, LEAD_STAGE_TRANSITIONS } from '@platform/shared';
import type { LeadDetailDTO } from '@platform/shared';
import { bffFetch, BffError } from '@/lib/session/client';
import { PermissionButton } from '@/components/common/PermissionButton';
import { Badge } from '@/components/common/Badge';
import { Modal } from '@/components/common/Modal';
import { upcomingTrialSessions, type TrialSessionRow } from '@/lib/leads/trial-sessions';

const STAGE_LABEL: Record<string, string> = {
  NEW: 'Yeni',
  CONTACTED: 'Görüşüldü',
  TRIAL_BOOKED: 'Deneme planlandı',
  TRIAL_DONE: 'Deneme yapıldı',
  WON: 'Üye oldu',
  LOST: 'Kaybedildi',
};

const inputStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};

export function LeadDetailDrawer({
  studioId,
  lead,
  onClose,
  onChanged,
}: {
  studioId: string;
  lead: LeadDetailDTO;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [note, setNote] = useState('');
  const [lostReason, setLostReason] = useState('');
  const [scheduleId, setScheduleId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionOptions, setSessionOptions] = useState<TrialSessionRow[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  const transitions = LEAD_STAGE_TRANSITIONS[lead.stage as LeadStage] ?? [];
  const canBookTrial = transitions.includes(LeadStage.TRIAL_BOOKED);

  useEffect(() => {
    if (!canBookTrial) return;
    let cancelled = false;
    setSessionsLoading(true);
    const now = new Date();
    const horizon = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const params = new URLSearchParams({ startDate: now.toISOString(), endDate: horizon.toISOString() });
    bffFetch<TrialSessionRow[]>(`schedules/studio/${studioId}?${params.toString()}`, { studioId })
      .then((rows) => {
        if (!cancelled) setSessionOptions(upcomingTrialSessions(rows, { branchId: lead.branchId, now }));
      })
      .catch(() => {
        if (!cancelled) setSessionOptions([]);
      })
      .finally(() => {
        if (!cancelled) setSessionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canBookTrial, studioId, lead.branchId]);

  async function addNote() {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await bffFetch(`leads/${lead.id}/activities`, { method: 'POST', studioId, body: { type: 'NOTE', body: note.trim() } });
      setNote('');
      onChanged();
    } catch (err) {
      setError(err instanceof BffError ? err.message : 'Not eklenemedi');
    } finally {
      setBusy(false);
    }
  }

  async function changeStage(stage: LeadStage) {
    if (stage === LeadStage.LOST && !lostReason.trim()) {
      setError('Kayıp nedeni giriniz');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await bffFetch(`leads/${lead.id}/stage`, { method: 'POST', studioId, body: { stage, lostReason: stage === LeadStage.LOST ? lostReason.trim() : undefined } });
      onChanged();
    } catch (err) {
      setError(err instanceof BffError ? err.message : 'Aşama güncellenemedi');
    } finally {
      setBusy(false);
    }
  }

  async function bookTrial() {
    if (!scheduleId.trim()) {
      setError('Bir seans seçiniz');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await bffFetch(`leads/${lead.id}/trial`, { method: 'POST', studioId, body: { scheduleId: scheduleId.trim() } });
      onChanged();
    } catch (err) {
      setError(err instanceof BffError ? err.message : 'Deneme dersi planlanamadı');
    } finally {
      setBusy(false);
    }
  }

  async function convert() {
    setBusy(true);
    setError(null);
    try {
      await bffFetch(`leads/${lead.id}/convert`, { method: 'POST', studioId, body: {} });
      onChanged();
    } catch (err) {
      setError(err instanceof BffError ? err.message : 'Üyeliğe dönüştürülemedi');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={lead.fullName} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge tone={lead.stage === 'WON' ? 'success' : lead.stage === 'LOST' ? 'danger' : 'info'}>{STAGE_LABEL[lead.stage] ?? lead.stage}</Badge>
          {lead.ownerName && (
            <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              Sorumlu: {lead.ownerName}
            </span>
          )}
        </div>

        <div className="text-sm space-y-1" style={{ color: 'var(--color-text-secondary)' }}>
          <div>Telefon: {lead.phone}</div>
          {lead.email && <div>E-posta: {lead.email}</div>}
          {lead.interestServiceTypeName && <div>İlgilendiği hizmet: {lead.interestServiceTypeName}</div>}
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        {lead.stage !== 'WON' && lead.stage !== 'LOST' && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {transitions
                .filter((s) => s !== LeadStage.LOST && s !== LeadStage.WON)
                .map((s) => (
                  <PermissionButton key={s} required={['leads.manage']} onClick={() => changeStage(s)} disabled={busy}>
                    {STAGE_LABEL[s]}
                  </PermissionButton>
                ))}
              {transitions.includes(LeadStage.WON) && (
                <PermissionButton required={['leads.manage']} variant="primary" onClick={convert} disabled={busy}>
                  Üyeliğe dönüştür
                </PermissionButton>
              )}
            </div>
            {canBookTrial && (
              <div className="flex items-center gap-2">
                <select
                  value={scheduleId}
                  onChange={(e) => setScheduleId(e.target.value)}
                  className="flex-1 text-xs px-2 py-1.5"
                  style={inputStyle}
                  disabled={sessionsLoading}
                >
                  <option value="">
                    {sessionsLoading
                      ? 'Seanslar yükleniyor...'
                      : sessionOptions.length === 0
                        ? 'Önümüzdeki 14 günde uygun seans yok'
                        : 'Seans seçin'}
                  </option>
                  {sessionOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {new Date(s.startTime).toLocaleString('tr-TR', {
                        weekday: 'short',
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {' - '}
                      {s.serviceType?.name ?? s.title} ({s.bookedCount}/{s.capacity})
                    </option>
                  ))}
                </select>
                <PermissionButton required={['leads.manage']} onClick={bookTrial} disabled={busy || !scheduleId}>
                  Deneme dersi planla
                </PermissionButton>
              </div>
            )}
            {transitions.includes(LeadStage.LOST) && (
              <div className="flex items-center gap-2">
                <input
                  placeholder="Kayıp nedeni"
                  value={lostReason}
                  onChange={(e) => setLostReason(e.target.value)}
                  className="flex-1 text-xs px-2 py-1.5"
                  style={inputStyle}
                />
                <PermissionButton required={['leads.manage']} variant="danger" onClick={() => changeStage(LeadStage.LOST)} disabled={busy}>
                  Kaybedildi
                </PermissionButton>
              </div>
            )}
          </div>
        )}

        <div>
          <h4 className="text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-primary)' }}>
            Geçmiş
          </h4>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {lead.activities.length === 0 && (
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                Henüz kayıt yok
              </p>
            )}
            {lead.activities.map((a) => (
              <div key={a.id} className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
                  {a.actorName ?? 'Sistem'}
                </span>{' '}
                {a.body} - {new Date(a.createdAt).toLocaleString('tr-TR')}
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input placeholder="Not ekle" value={note} onChange={(e) => setNote(e.target.value)} className="flex-1 text-sm px-3 py-1.5" style={inputStyle} />
          <PermissionButton required={['leads.manage']} onClick={addNote} disabled={busy}>
            Ekle
          </PermissionButton>
        </div>
      </div>
    </Modal>
  );
}

