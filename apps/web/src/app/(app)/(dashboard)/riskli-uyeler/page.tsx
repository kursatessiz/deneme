'use client';

import { useEffect, useState } from 'react';
import type { ChurnListResponseDTO, ChurnMemberSummaryDTO, ChurnRiskLevel, ChurnSummaryDTO } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { bffFetch, BffError } from '@/lib/session/client';
import { PageGuard } from '@/components/common/PageGuard';
import { PermissionButton } from '@/components/common/PermissionButton';
import { Badge } from '@/components/common/Badge';
import { Modal } from '@/components/common/Modal';
import { BranchSelect } from '@/components/common/BranchSelect';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { ChurnSummaryTiles } from '@/components/churn/ChurnSummaryTiles';
import { Checkbox, Input, Select, Textarea } from '@/components/ui';
import { PageHeader } from '@/components/ui/PageHeader';
import { AnchorButton } from '@/components/ui/LinkButton';

const LEVEL_TONE: Record<string, 'danger' | 'warning' | 'neutral'> = { HIGH: 'danger', MEDIUM: 'warning', LOW: 'neutral' };

function ContactedDialog({ studioId, member, onClose, onDone }: { studioId: string; member: ChurnMemberSummaryDTO; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) {
      setError(t('churn.contactedDialog.noteRequired'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await bffFetch(`churn/studio/${studioId}/members/${member.memberId}/contacted`, { method: 'POST', studioId, body: { note: note.trim() } });
      onDone();
    } catch (err) {
      setError(err instanceof BffError ? err.message : t('churn.contactedDialog.errors.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={t('churn.contactedDialog.title', { name: `${member.firstName} ${member.lastName}` })} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <Textarea
          placeholder={t('churn.contactedDialog.notePlaceholder')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
        />
        {error && <p className="ui-text-error ui-small">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <PermissionButton type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </PermissionButton>
          <PermissionButton required={['members.manage']} type="submit" variant="primary" disabled={submitting}>
            {submitting ? t('common.saving') : t('common.save')}
          </PermissionButton>
        </div>
      </form>
    </Modal>
  );
}

function ChurnList() {
  const t = useT();
  const locale = useLocale();
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
        .catch((err) => setError(err instanceof BffError ? err.message : t('churn.errors.loadFailed')))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStudioId, level, branchId, includeSnoozed, search, reloadKey]);

  async function handleSnooze(member: ChurnMemberSummaryDTO, days: number) {
    if (!activeStudioId) return;
    try {
      await bffFetch(`churn/studio/${activeStudioId}/members/${member.memberId}/snooze`, { method: 'POST', studioId: activeStudioId, body: { days } });
      setReloadKey((k) => k + 1);
    } catch (err) {
      window.alert(err instanceof BffError ? err.message : t('churn.errors.snoozeFailed'));
    }
  }

  async function handleRecompute() {
    if (!activeStudioId) return;
    try {
      await bffFetch(`churn/studio/${activeStudioId}/recompute`, { method: 'POST', studioId: activeStudioId, body: {} });
      setReloadKey((k) => k + 1);
    } catch (err) {
      window.alert(err instanceof BffError ? err.message : t('churn.errors.recomputeFailed'));
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
      <PageHeader
        title={t('churn.title')}
        description={t('churn.subtitle')}
        actions={
          <>
            <AnchorButton variant="outline" tone="surface" size="sm" href={exportHref}>
              {t('churn.downloadCsv')}
            </AnchorButton>
            <PermissionButton required={['members.manage']} onClick={handleRecompute}>
              {t('churn.recompute')}
            </PermissionButton>
          </>
        }
      />

      {summary && <ChurnSummaryTiles summary={summary} />}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder={t('churn.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px]"
        />
        <Select value={level} onChange={(e) => setLevel(e.target.value as ChurnRiskLevel | '')}>
          <option value="">{t('churn.allLevels')}</option>
          <option value="HIGH">{t('churn.level.HIGH')}</option>
          <option value="MEDIUM">{t('churn.level.MEDIUM')}</option>
          <option value="LOW">{t('churn.level.LOW')}</option>
        </Select>
        <BranchSelect value={branchId} onChange={setBranchId} />
        <Checkbox label={t('churn.showSnoozed')} checked={includeSnoozed} onChange={(e) => setIncludeSnoozed(e.target.checked)} />
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!members || members.length === 0) && <EmptyState title={t('churn.empty.title')} description={t('churn.empty.description')} />}

      {!loading && !error && members && members.length > 0 && (
        <div className="space-y-2">
          {members.map((m) => (
            <div key={m.memberId} className="p-4 flex flex-wrap items-start justify-between gap-3 pui-card">
              <div>
                <div className="flex items-center gap-2">
                  <a href={`/members/${m.memberId}`} className="pui-link pui-surface ui-strong">
                    {m.firstName} {m.lastName}
                  </a>
                  <Badge tone={LEVEL_TONE[m.level]}>{t(`churn.level.${m.level}`)}</Badge>
                  <span className="ui-caption">
                    {t('churn.score', { score: m.score })}
                    {m.previousScore !== null && m.previousScore !== m.score ? t('churn.previousScore', { score: m.previousScore }) : ''}
                  </span>
                </div>
                <ul className="mt-1 space-y-0.5 ui-caption">
                  {m.reasons.slice(0, 3).map((r) => (
                    <li key={r.key}>- {r.label}</li>
                  ))}
                </ul>
                {m.contactedAt && (
                  <div className="mt-1 ui-caption">
                    {t('churn.lastContact', { date: new Date(m.contactedAt).toLocaleDateString(locale) })}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <PermissionButton required={['members.manage']} onClick={() => setContactingMember(m)}>
                  {t('churn.contacted')}
                </PermissionButton>
                <PermissionButton required={['members.manage']} onClick={() => handleSnooze(m, 14)}>
                  {t('churn.snooze14')}
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
