'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useDashboardSession, useFormatMoney } from '@/components/session/DashboardSessionProvider';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { bffFetch, BffError } from '@/lib/session/client';
import { useBff } from '@/lib/session/use-bff';
import { LoadingState, ErrorState } from '@/components/common/DataState';
import { PageGuard } from '@/components/common/PageGuard';
import { PermissionButton } from '@/components/common/PermissionButton';
import { Badge } from '@/components/common/Badge';
import { Modal } from '@/components/common/Modal';
import { PackageSaleDialog } from '@/components/members/PackageSaleDialog';
import { hasAnyPermission } from '@/lib/nav';
import { bookingStatusLabel, packageStatusLabel, type MemberDetail } from '@/lib/members/types';

interface PackageDefinitionRow {
  id: string;
  name: string;
  price: string | number;
}

interface ChurnSummary {
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  reasons: { label: string }[];
}

interface AchievementSummary {
  memberId: string;
  totalAttendedSessions: number;
  currentStreakWeeks: number;
  bestStreakWeeks: number;
  badgeCount: number;
}

const RISK_TONE: Record<ChurnSummary['level'], 'success' | 'warning' | 'danger'> = { LOW: 'success', MEDIUM: 'warning', HIGH: 'danger' };

function MemberCard() {
  const t = useT();
  const params = useParams<{ memberId: string }>();
  const router = useRouter();
  const { activeStudioId, permissions, isOwner } = useDashboardSession();
  const locale = useLocale();
  const formatMoney = useFormatMoney();
  const memberId = params.memberId;
  const riskLabel = (level: ChurnSummary['level']) => t(`members.card.risk.${level}`);

  const [member, setMember] = useState<MemberDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [churn, setChurn] = useState<ChurnSummary | null>(null);
  const [achievement, setAchievement] = useState<AchievementSummary | null>(null);
  const [showSell, setShowSell] = useState(false);
  const [freezeDays, setFreezeDays] = useState<Record<string, string>>({});
  const [busyPackageId, setBusyPackageId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: packageDefinitions } = useBff<PackageDefinitionRow[]>(`catalog/package-definitions/studio/${activeStudioId}`, activeStudioId);

  const canViewContact = hasAnyPermission(['members.contact.view'], permissions, isOwner);
  const canSell = hasAnyPermission(['packages.sell'], permissions, isOwner);

  function load() {
    // Only show the full-page spinner for the initial fetch. A background
    // refresh (after selling a package, freezing one, ...) must not flip
    // `loading` back to true: the early `if (loading) return <LoadingState
    // />` below would replace the whole tree, including the open sale
    // dialog, discarding its just-set "sale complete" result before the
    // member ever sees it.
    if (!member) setLoading(true);
    setError(null);
    bffFetch<MemberDetail>(`members/${memberId}/studio/${activeStudioId}`, { studioId: activeStudioId })
      .then(setMember)
      .catch((err) => setError(err instanceof BffError ? err.message : t('members.card.errors.loadFailed')))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!activeStudioId || !memberId) return;
    load();
    // Churn risk and gamification are best-effort extras: a 404 (no risk
    // snapshot yet) or a missing permission simply leaves the section out.
    bffFetch<ChurnSummary>(`churn/studio/${activeStudioId}/members/${memberId}`, { studioId: activeStudioId })
      .then(setChurn)
      .catch(() => setChurn(null));
    bffFetch<AchievementSummary[]>(`gamification/studio/${activeStudioId}/achievements`, { studioId: activeStudioId })
      .then((rows) => setAchievement(rows.find((r) => r.memberId === memberId) ?? null))
      .catch(() => setAchievement(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStudioId, memberId]);

  async function runPackageAction(packageId: string, action: () => Promise<unknown>) {
    setBusyPackageId(packageId);
    setActionError(null);
    try {
      await action();
      load();
    } catch (err) {
      setActionError(err instanceof BffError ? err.message : t('members.card.errors.actionFailed'));
    } finally {
      setBusyPackageId(null);
    }
  }

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!member) return <ErrorState message={t('members.card.notFound')} />;

  const activePackages = member.packages.filter((p) => p.status === 'ACTIVE' || p.status === 'FROZEN');
  const otherPackages = member.packages.filter((p) => p.status !== 'ACTIVE' && p.status !== 'FROZEN');

  return (
    <div className="space-y-6">
      <button onClick={() => router.push('/members')} className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        ← {t('members.card.back')}
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <div className="p-5" style={{ borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            <div className="flex items-start justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
                  {member.firstName} {member.lastName}
                </h2>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {member.isPartnerGuest && <Badge tone="info">{t('members.partnerGuest')}</Badge>}
                  {churn && <Badge tone={RISK_TONE[churn.level]}>{riskLabel(churn.level)}</Badge>}
                </div>
              </div>
              <PermissionButton required={['packages.sell']} variant="primary" onClick={() => setShowSell(true)}>
                {t('members.card.sellPackage')}
              </PermissionButton>
            </div>

            <dl className="grid grid-cols-2 gap-3 mt-4 text-sm">
              {canViewContact && (
                <>
                  <div>
                    <dt style={{ color: 'var(--color-text-muted)' }}>{t('members.card.phone')}</dt>
                    <dd style={{ color: 'var(--color-text-primary)' }}>{member.phone ?? '—'}</dd>
                  </div>
                  <div>
                    <dt style={{ color: 'var(--color-text-muted)' }}>{t('members.card.email')}</dt>
                    <dd style={{ color: 'var(--color-text-primary)' }}>{member.email ?? '—'}</dd>
                  </div>
                </>
              )}
              <div>
                <dt style={{ color: 'var(--color-text-muted)' }}>{t('members.card.homeBranch')}</dt>
                <dd style={{ color: 'var(--color-text-primary)' }}>{member.homeBranchId ?? t('members.card.unspecified')}</dd>
              </div>
              <div>
                <dt style={{ color: 'var(--color-text-muted)' }}>{t('members.card.totalBookings')}</dt>
                <dd style={{ color: 'var(--color-text-primary)' }}>{member.bookingsCount ?? member.bookings.length}</dd>
              </div>
            </dl>

            {member.notes && (
              <div className="mt-4">
                <dt className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {t('members.card.notes')}
                </dt>
                <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                  {member.notes}
                </p>
              </div>
            )}
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>
              {t('members.card.activePackages')}
            </h3>
            {activePackages.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {t('members.card.noActivePackages')}
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {activePackages.map((pkg) => (
                  <div key={pkg.id} className="p-4 flex flex-col justify-between" style={{ borderRadius: 'var(--radius-card)', background: 'var(--gradient-brand)', color: 'var(--color-on-primary)' }}>
                    <div>
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold text-sm">{pkg.packageDefinition?.name ?? t('members.card.defaultPackageName')}</h4>
                        <span className="text-[10px] px-2 py-0.5" style={{ borderRadius: 'var(--radius-chip)', backgroundColor: 'rgba(255,255,255,0.2)' }}>
                          {packageStatusLabel(t, pkg.status)}
                        </span>
                      </div>
                      <p className="text-2xl font-extrabold mt-2">
                        {pkg.entitlementKind === 'TIME_UNLIMITED' ? t('members.card.unlimited') : `${pkg.remainingUnits ?? 0}/${pkg.totalUnits ?? '—'}`}
                      </p>
                      <p className="text-xs opacity-90 mt-1">{t('members.card.remainingUnits')}</p>
                    </div>
                    <div className="mt-3 text-xs opacity-90 space-y-0.5">
                      <div>{t('members.card.endDate', { date: new Date(pkg.endDate).toLocaleDateString(locale) })}</div>
                      {pkg.frozenUntil && <div>{t('members.card.frozenUntil', { date: new Date(pkg.frozenUntil).toLocaleDateString(locale) })}</div>}
                    </div>
                    <PermissionButton required={['packages.sell']} variant="secondary" className="mt-3 self-start" style={{ backgroundColor: 'rgba(255,255,255,0.9)' }}
                      disabled={busyPackageId === pkg.id}
                      onClick={() => {
                        if (pkg.status === 'FROZEN') {
                          runPackageAction(pkg.id, () => bffFetch(`members/packages/${pkg.id}/unfreeze`, { method: 'POST', studioId: activeStudioId, body: { studioId: activeStudioId } }));
                        } else {
                          const days = Number(freezeDays[pkg.id] ?? '7');
                          runPackageAction(pkg.id, () => bffFetch(`members/packages/${pkg.id}/freeze`, { method: 'POST', studioId: activeStudioId, body: { studioId: activeStudioId, days } }));
                        }
                      }}
                    >
                      {pkg.status === 'FROZEN' ? t('members.card.unfreeze') : t('members.card.freeze')}
                    </PermissionButton>
                    {pkg.status !== 'FROZEN' && (
                      <input
                        type="number"
                        min={1}
                        placeholder={t('members.card.daysPlaceholder')}
                        className="mt-1.5 w-20 text-xs px-2 py-1"
                        style={{ borderRadius: 'var(--radius-input)', border: '1px solid rgba(255,255,255,0.4)', backgroundColor: 'rgba(255,255,255,0.15)', color: 'inherit' }}
                        value={freezeDays[pkg.id] ?? ''}
                        onChange={(e) => setFreezeDays((f) => ({ ...f, [pkg.id]: e.target.value }))}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
            {actionError && (
              <p className="text-xs mt-2" style={{ color: '#b42318' }}>
                {actionError}
              </p>
            )}
          </div>

          {otherPackages.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>
                {t('members.card.pastPackages')}
              </h3>
              <div className="space-y-1.5">
                {otherPackages.map((pkg) => (
                  <div key={pkg.id} className="flex items-center justify-between px-3 py-2 text-xs" style={{ borderRadius: 'var(--radius-chip)', backgroundColor: 'var(--color-surface-muted)' }}>
                    <span style={{ color: 'var(--color-text-primary)' }}>{pkg.packageDefinition?.name ?? t('members.card.defaultPackageName')}</span>
                    <Badge tone="neutral">{packageStatusLabel(t, pkg.status)}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>
              {t('members.card.bookingHistory')}
            </h3>
            {member.bookings.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {t('members.card.noBookingsYet')}
              </p>
            ) : (
              <div className="border overflow-hidden" style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-card)' }}>
                <table className="w-full text-sm">
                  <tbody>
                    {member.bookings.map((b) => (
                      <tr key={b.id} className="border-t first:border-t-0" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                        <td className="px-3 py-2" style={{ color: 'var(--color-text-primary)' }}>
                          {b.schedule?.title ?? t('members.card.defaultSessionName')}
                        </td>
                        <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                          {b.schedule ? new Date(b.schedule.startTime).toLocaleString(locale) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Badge tone="neutral">{bookingStatusLabel(t, b.status)}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>
              {t('members.card.payments')}
            </h3>
            {member.payments.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {t('members.card.noPaymentsYet')}
              </p>
            ) : (
              <div className="space-y-1.5">
                {member.payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between px-3 py-2 text-xs" style={{ borderRadius: 'var(--radius-chip)', backgroundColor: 'var(--color-surface-muted)' }}>
                    <span style={{ color: 'var(--color-text-primary)' }}>{formatMoney(p.amount)}</span>
                    <span style={{ color: 'var(--color-text-secondary)' }}>{p.paidAt ? new Date(p.paidAt).toLocaleDateString(locale) : '—'}</span>
                    <Badge tone="neutral">{p.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {(member.bookingsCount ?? 0) >= 0 && (
            <div className="p-4" style={{ borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
              <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>
                {t('members.card.attendanceStats')}
              </h3>
              <p className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
                {member.bookings.filter((b) => b.status === 'ATTENDED').length}
              </p>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {t('members.card.attendedSessions')}
              </p>
            </div>
          )}

          {achievement && (
            <div className="p-4" style={{ borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
              <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>
                {t('members.card.gamification')}
              </h3>
              <dl className="text-xs space-y-1">
                <div className="flex justify-between">
                  <dt style={{ color: 'var(--color-text-muted)' }}>{t('members.card.totalAttendance')}</dt>
                  <dd style={{ color: 'var(--color-text-primary)' }}>{achievement.totalAttendedSessions}</dd>
                </div>
                <div className="flex justify-between">
                  <dt style={{ color: 'var(--color-text-muted)' }}>{t('members.card.currentStreak')}</dt>
                  <dd style={{ color: 'var(--color-text-primary)' }}>{t('members.card.weeksUnit', { count: achievement.currentStreakWeeks })}</dd>
                </div>
                <div className="flex justify-between">
                  <dt style={{ color: 'var(--color-text-muted)' }}>{t('members.card.bestStreak')}</dt>
                  <dd style={{ color: 'var(--color-text-primary)' }}>{t('members.card.weeksUnit', { count: achievement.bestStreakWeeks })}</dd>
                </div>
                <div className="flex justify-between">
                  <dt style={{ color: 'var(--color-text-muted)' }}>{t('members.card.badgeCount')}</dt>
                  <dd style={{ color: 'var(--color-text-primary)' }}>{achievement.badgeCount}</dd>
                </div>
              </dl>
            </div>
          )}

          {churn && churn.reasons.length > 0 && (
            <div className="p-4" style={{ borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
              <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>
                {t('members.card.riskReasons')}
              </h3>
              <ul className="text-xs space-y-1" style={{ color: 'var(--color-text-primary)' }}>
                {churn.reasons.map((r, i) => (
                  <li key={i}>• {r.label}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {showSell && canSell && (
        <Modal title={t('members.card.sellPackage')} onClose={() => setShowSell(false)}>
          <PackageSaleDialog
            studioId={activeStudioId}
            memberId={memberId}
            packageDefinitions={packageDefinitions ?? []}
            onClose={() => setShowSell(false)}
            onSold={load}
          />
        </Modal>
      )}
    </div>
  );
}

export default function MemberCardPage() {
  return (
    <PageGuard required={['members.view']}>
      <MemberCard />
    </PageGuard>
  );
}
