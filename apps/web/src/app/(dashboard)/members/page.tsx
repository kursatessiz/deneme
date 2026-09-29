'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { bffFetch, BffError } from '@/lib/session/client';
import { useBff } from '@/lib/session/use-bff';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { PageGuard } from '@/components/common/PageGuard';
import { Badge } from '@/components/common/Badge';

interface MemberRow {
  id: string;
  firstName: string;
  lastName: string;
  phone?: string;
  bookingsCount?: number;
  packages?: { id: string; status: string }[];
  isPartnerGuest?: boolean;
}

interface BranchRow {
  id: string;
  name: string;
}

function MembersList() {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const [search, setSearch] = useState('');
  const [homeBranchId, setHomeBranchId] = useState('');
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { data: branches } = useBff<BranchRow[]>(`branches/studio/${activeStudioId}`, activeStudioId);

  useEffect(() => {
    if (!activeStudioId) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (homeBranchId) params.set('homeBranchId', homeBranchId);
    const query = params.toString();
    const timer = setTimeout(() => {
      bffFetch<MemberRow[]>(`members/studio/${activeStudioId}${query ? `?${query}` : ''}`, { studioId: activeStudioId })
        .then(setMembers)
        .catch((err) => setError(err instanceof BffError ? err.message : t('members.errors.loadFailed')))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStudioId, search, homeBranchId]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
          {t('members.title')}
        </h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          {t('members.subtitle')}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          placeholder={t('members.searchPlaceholder')}
          className="text-sm px-3 py-1.5 flex-1 min-w-[220px]"
          style={{ borderRadius: 'var(--radius-input)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text-primary)' }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="text-sm px-3 py-1.5"
          style={{ borderRadius: 'var(--radius-input)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text-primary)' }}
          value={homeBranchId}
          onChange={(e) => setHomeBranchId(e.target.value)}
        >
          <option value="">{t('members.allBranches')}</option>
          {branches?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!members || members.length === 0) && (
        <EmptyState title={t('members.empty.title')} description={t('members.empty.description')} />
      )}
      {!loading && !error && members && members.length > 0 && (
        <div className="border overflow-hidden" style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-card)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--color-surface-muted)' }}>
                <th className="text-left px-4 py-2.5 font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                  {t('members.col.name')}
                </th>
                <th className="text-left px-4 py-2.5 font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                  {t('members.col.phone')}
                </th>
                <th className="text-left px-4 py-2.5 font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                  {t('members.col.activePackage')}
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-t" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                  <td className="px-4 py-2.5">
                    <Link href={`/members/${m.id}`} className="hover:underline" style={{ color: 'var(--color-text-primary)' }}>
                      {m.firstName} {m.lastName}
                    </Link>
                    {m.isPartnerGuest && (
                      <span className="ml-2">
                        <Badge tone="info">{t('members.partnerGuest')}</Badge>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--color-text-secondary)' }}>
                    {m.phone ?? '—'}
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--color-text-secondary)' }}>
                    {m.packages && m.packages.filter((p) => p.status === 'ACTIVE').length > 0
                      ? m.packages.filter((p) => p.status === 'ACTIVE').length
                      : t('members.noActivePackage')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function MembersPage() {
  return (
    <PageGuard required={['members.view']}>
      <MembersList />
    </PageGuard>
  );
}
