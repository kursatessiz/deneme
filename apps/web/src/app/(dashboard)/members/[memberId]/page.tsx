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
import { AlertTriangle, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { Input } from '@/components/ui/Input';
import { StatTile } from '@/components/ui/StatTile';
import { Table, Tbody, Td, Tr } from '@/components/ui/Table';
import { PackageSaleDialog } from '@/components/members/PackageSaleDialog';
import { LoyaltyPanel } from '@/components/loyalty/LoyaltyPanel';
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

  const fullName = `${member.firstName} ${member.lastName}`;

  return (
    <div className="grid gap-6">
      <div>
        <Button variant="link" tone="muted" size="sm" onClick={() => router.push('/members')} icon={<ArrowLeft className="ui-icon" aria-hidden="true" />}>
          {t('members.card.back')}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 grid gap-6">
          <section className="pui-card ui-gradient-member-card">
            <div className="pui-card-content gap-4">
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <Avatar name={fullName} tone="inverse" />
                  <div className="grid gap-1">
                    <h2 className="ui-title">{fullName}</h2>
                    <div className="flex flex-wrap gap-1.5">
                      {member.isPartnerGuest && <Badge tone="info">{t('members.partnerGuest')}</Badge>}
                      {churn && <Badge tone={RISK_TONE[churn.level]}>{riskLabel(churn.level)}</Badge>}
                    </div>
                  </div>
                </div>
                <PermissionButton required={['packages.sell']} variant="secondary" mode="disable" onClick={() => setShowSell(true)} style={{ backgroundColor: 'var(--pui-bg)' }}>
                  {t('members.card.sellPackage')}
                </PermissionButton>
              </div>

              <dl className="grid grid-cols-2 gap-3">
                {canViewContact && (
                  <>
                    <div className="grid gap-0.5">
                      <dt className="ui-caption" style={{ color: 'inherit', opacity: 0.8 }}>{t('members.card.phone')}</dt>
                      <dd>{member.phone ?? '—'}</dd>
                    </div>
                    <div className="grid gap-0.5">
                      <dt className="ui-caption" style={{ color: 'inherit', opacity: 0.8 }}>{t('members.card.email')}</dt>
                      <dd>{member.email ?? '—'}</dd>
                    </div>
                  </>
                )}
                <div className="grid gap-0.5">
                  <dt className="ui-caption" style={{ color: 'inherit', opacity: 0.8 }}>{t('members.card.homeBranch')}</dt>
                  <dd>{member.homeBranchId ?? t('members.card.unspecified')}</dd>
                </div>
                <div className="grid gap-0.5">
                  <dt className="ui-caption" style={{ color: 'inherit', opacity: 0.8 }}>{t('members.card.totalBookings')}</dt>
                  <dd>{member.bookingsCount ?? member.bookings.length}</dd>
                </div>
              </dl>

              {member.notes && (
                <div className="grid gap-0.5">
                  <span className="ui-caption" style={{ color: 'inherit', opacity: 0.8 }}>
                    {t('members.card.notes')}
                  </span>
                  <p>{member.notes}</p>
                </div>
              )}
            </div>
          </section>

          <div className="grid gap-3">
            <h3 className="ui-heading">{t('members.card.activePackages')}</h3>
            {activePackages.length === 0 ? (
              <p className="ui-caption">{t('members.card.noActivePackages')}</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {activePackages.map((pkg) => (
                  <div key={pkg.id} className="pui-card ui-gradient-package-card">
                    <div className="pui-card-content">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="ui-heading">{pkg.packageDefinition?.name ?? t('members.card.defaultPackageName')}</h4>
                        <span className="pui-badge pui-solid pui-inverse">{packageStatusLabel(t, pkg.status)}</span>
                      </div>
                      <div className="grid">
                        <span className="ui-stat-value">
                          {pkg.entitlementKind === 'TIME_UNLIMITED' ? t('members.card.unlimited') : `${pkg.remainingUnits ?? 0}/${pkg.totalUnits ?? '—'}`}
                        </span>
                        <span className="ui-caption" style={{ color: 'inherit', opacity: 0.85 }}>
                          {t('members.card.remainingUnits')}
                        </span>
                      </div>
                      <div className="ui-caption grid gap-0.5" style={{ color: 'inherit', opacity: 0.85 }}>
                        <span>{t('members.card.endDate', { date: new Date(pkg.endDate).toLocaleDateString(locale) })}</span>
                        {pkg.frozenUntil && <span>{t('members.card.frozenUntil', { date: new Date(pkg.frozenUntil).toLocaleDateString(locale) })}</span>}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <PermissionButton
                          required={['packages.sell']}
                          variant="secondary"
                          style={{ backgroundColor: 'var(--pui-bg)' }}
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
                          <Input
                            type="number"
                            min={1}
                            placeholder={t('members.card.daysPlaceholder')}
                            className="w-24"
                            style={{ backgroundColor: 'var(--pui-bg)', color: 'var(--pui-text)' }}
                            value={freezeDays[pkg.id] ?? ''}
                            onChange={(e) => setFreezeDays((f) => ({ ...f, [pkg.id]: e.target.value }))}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {actionError && (
              <p className="ui-caption" style={{ color: 'var(--pui-error)' }}>
                {actionError}
              </p>
            )}
          </div>

          {otherPackages.length > 0 && (
            <div className="grid gap-3">
              <h3 className="ui-heading">{t('members.card.pastPackages')}</h3>
              <div className="pui-card">
                <ul className="pui-list">
                  {otherPackages.map((pkg) => (
                    <li key={pkg.id} className="pui-list-item flex items-center justify-between gap-3">
                      <span>{pkg.packageDefinition?.name ?? t('members.card.defaultPackageName')}</span>
                      <Badge tone="neutral">{packageStatusLabel(t, pkg.status)}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <div className="grid gap-3">
            <h3 className="ui-heading">{t('members.card.bookingHistory')}</h3>
            {member.bookings.length === 0 ? (
              <p className="ui-caption">{t('members.card.noBookingsYet')}</p>
            ) : (
              <div className="pui-card overflow-x-auto">
                <Table>
                  <Tbody>
                    {member.bookings.map((b) => (
                      <Tr key={b.id}>
                        <Td>{b.schedule?.title ?? t('members.card.defaultSessionName')}</Td>
                        <Td className="ui-text-muted">{b.schedule ? new Date(b.schedule.startTime).toLocaleString(locale) : '—'}</Td>
                        <Td style={{ textAlign: 'end' }}>
                          <Badge tone="neutral">{bookingStatusLabel(t, b.status)}</Badge>
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </div>
            )}
          </div>

          <div className="grid gap-3">
            <h3 className="ui-heading">{t('members.card.payments')}</h3>
            {member.payments.length === 0 ? (
              <p className="ui-caption">{t('members.card.noPaymentsYet')}</p>
            ) : (
              <div className="pui-card">
                <ul className="pui-list">
                  {member.payments.map((p) => (
                    <li key={p.id} className="pui-list-item flex items-center justify-between gap-3">
                      <span className="ui-heading">{formatMoney(p.amount)}</span>
                      <span className="ui-text-muted">{p.paidAt ? new Date(p.paidAt).toLocaleDateString(locale) : '—'}</span>
                      <Badge tone="neutral">{p.status}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-4">
          <LoyaltyPanel memberId={memberId} />

          {(member.bookingsCount ?? 0) >= 0 && (
            <StatTile
              label={t('members.card.attendanceStats')}
              value={member.bookings.filter((b) => b.status === 'ATTENDED').length}
              hint={t('members.card.attendedSessions')}
              icon={<CheckCircle2 className="ui-icon" aria-hidden="true" />}
              tone="success"
            />
          )}

          {achievement && (
            <section className="pui-card">
              <div className="pui-card-header">
                <h3 className="ui-heading">{t('members.card.gamification')}</h3>
              </div>
              <dl className="pui-card-content gap-2">
                <div className="flex justify-between gap-3">
                  <dt className="ui-text-muted">{t('members.card.totalAttendance')}</dt>
                  <dd>{achievement.totalAttendedSessions}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="ui-text-muted">{t('members.card.currentStreak')}</dt>
                  <dd>{t('members.card.weeksUnit', { count: achievement.currentStreakWeeks })}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="ui-text-muted">{t('members.card.bestStreak')}</dt>
                  <dd>{t('members.card.weeksUnit', { count: achievement.bestStreakWeeks })}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="ui-text-muted">{t('members.card.badgeCount')}</dt>
                  <dd>{achievement.badgeCount}</dd>
                </div>
              </dl>
            </section>
          )}

          {churn && churn.reasons.length > 0 && (
            <section className="pui-card">
              <div className="pui-card-header">
                <h3 className="ui-heading">{t('members.card.riskReasons')}</h3>
              </div>
              <ul className="pui-list">
                {churn.reasons.map((r, i) => (
                  <li key={i} className="pui-list-item flex items-center gap-2">
                    <AlertTriangle className="ui-icon" style={{ color: 'var(--pui-warn)' }} aria-hidden="true" />
                    {r.label}
                  </li>
                ))}
              </ul>
            </section>
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
