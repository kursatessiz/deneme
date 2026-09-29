'use client';

import { useEffect, useState } from 'react';
import { LeadStage, LEAD_STAGE_TRANSITIONS } from '@platform/shared';
import type { LeadDetailDTO } from '@platform/shared';
import { bffFetch, BffError } from '@/lib/session/client';
import { PermissionButton } from '@/components/common/PermissionButton';
import { Badge } from '@/components/common/Badge';
import { Modal } from '@/components/common/Modal';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { upcomingTrialSessions, type TrialSessionRow } from '@/lib/leads/trial-sessions';

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
  const t = useT();
  const locale = useLocale();
  const [note, setNote] = useState('');
  const [lostReason, setLostReason] = useState('');
  const [scheduleId, setScheduleId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionOptions, setSessionOptions] = useState<TrialSessionRow[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const stageLabel = (s: string) => t(`leads.stage.${s}`);

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
      setError(err instanceof BffError ? err.message : t('leads.detail.errors.noteFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function changeStage(stage: LeadStage) {
    if (stage === LeadStage.LOST && !lostReason.trim()) {
      setError(t('leads.detail.lostReasonRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await bffFetch(`leads/${lead.id}/stage`, { method: 'POST', studioId, body: { stage, lostReason: stage === LeadStage.LOST ? lostReason.trim() : undefined } });
      onChanged();
    } catch (err) {
      setError(err instanceof BffError ? err.message : t('leads.detail.errors.stageChangeFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function bookTrial() {
    if (!scheduleId.trim()) {
      setError(t('leads.detail.sessionRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await bffFetch(`leads/${lead.id}/trial`, { method: 'POST', studioId, body: { scheduleId: scheduleId.trim() } });
      onChanged();
    } catch (err) {
      setError(err instanceof BffError ? err.message : t('leads.detail.errors.trialBookFailed'));
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
      setError(err instanceof BffError ? err.message : t('leads.detail.errors.convertFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={lead.fullName} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge tone={lead.stage === 'WON' ? 'success' : lead.stage === 'LOST' ? 'danger' : 'info'}>{stageLabel(lead.stage)}</Badge>
          {lead.ownerName && (
            <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              {t('leads.detail.owner', { name: lead.ownerName })}
            </span>
          )}
        </div>

        <div className="text-sm space-y-1" style={{ color: 'var(--color-text-secondary)' }}>
          <div>{t('leads.detail.phone', { phone: lead.phone })}</div>
          {lead.email && <div>{t('leads.detail.email', { email: lead.email })}</div>}
          {lead.interestServiceTypeName && <div>{t('leads.detail.interestedService', { name: lead.interestServiceTypeName })}</div>}
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        {lead.stage !== 'WON' && lead.stage !== 'LOST' && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {transitions
                .filter((s) => s !== LeadStage.LOST && s !== LeadStage.WON)
                .map((s) => (
                  <PermissionButton key={s} required={['leads.manage']} onClick={() => changeStage(s)} disabled={busy}>
                    {stageLabel(s)}
                  </PermissionButton>
                ))}
              {transitions.includes(LeadStage.WON) && (
                <PermissionButton required={['leads.manage']} variant="primary" onClick={convert} disabled={busy}>
                  {t('leads.detail.convert')}
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
                      ? t('leads.detail.sessionsLoading')
                      : sessionOptions.length === 0
                        ? t('leads.detail.noUpcomingSessions')
                        : t('leads.detail.chooseSession')}
                  </option>
                  {sessionOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {new Date(s.startTime).toLocaleString(locale, {
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
                  {t('leads.detail.bookTrial')}
                </PermissionButton>
              </div>
            )}
            {transitions.includes(LeadStage.LOST) && (
              <div className="flex items-center gap-2">
                <input
                  placeholder={t('leads.detail.lostReasonPlaceholder')}
                  value={lostReason}
                  onChange={(e) => setLostReason(e.target.value)}
                  className="flex-1 text-xs px-2 py-1.5"
                  style={inputStyle}
                />
                <PermissionButton required={['leads.manage']} variant="danger" onClick={() => changeStage(LeadStage.LOST)} disabled={busy}>
                  {t('leads.detail.markLost')}
                </PermissionButton>
              </div>
            )}
          </div>
        )}

        <div>
          <h4 className="text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-primary)' }}>
            {t('leads.detail.history')}
          </h4>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {lead.activities.length === 0 && (
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {t('leads.detail.noHistory')}
              </p>
            )}
            {lead.activities.map((a) => (
              <div key={a.id} className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
                  {a.actorName ?? t('leads.detail.system')}
                </span>{' '}
                {a.body} - {new Date(a.createdAt).toLocaleString(locale)}
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            placeholder={t('leads.detail.addNotePlaceholder')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="flex-1 text-sm px-3 py-1.5"
            style={inputStyle}
          />
          <PermissionButton required={['leads.manage']} onClick={addNote} disabled={busy}>
            {t('leads.detail.addNote')}
          </PermissionButton>
        </div>
      </div>
    </Modal>
  );
}
