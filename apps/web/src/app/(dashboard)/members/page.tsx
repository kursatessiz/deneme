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
import { Search } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Addon, InputGroup } from '@/components/ui/InputGroup';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui/Table';
import { Avatar } from '@/components/ui/Avatar';

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
    <div className="grid gap-6">
      <PageHeader title={t('members.title')} description={t('members.subtitle')} />

      <div className="flex flex-wrap gap-2">
        <InputGroup className="flex-1 min-w-[220px]">
          <Addon>
            <Search className="ui-icon" aria-hidden="true" />
          </Addon>
          <Input placeholder={t('members.searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} />
        </InputGroup>
        <Select value={homeBranchId} onChange={(e) => setHomeBranchId(e.target.value)}>
          <option value="">{t('members.allBranches')}</option>
          {branches?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!members || members.length === 0) && (
        <EmptyState title={t('members.empty.title')} description={t('members.empty.description')} />
      )}
      {!loading && !error && members && members.length > 0 && (
        <div className="pui-card overflow-x-auto">
          <Table hoverable>
            <Thead>
              <Tr>
                <Th>{t('members.col.name')}</Th>
                <Th>{t('members.col.phone')}</Th>
                <Th>{t('members.col.activePackage')}</Th>
              </Tr>
            </Thead>
            <Tbody>
              {members.map((m) => {
                const active = (m.packages ?? []).filter((p) => p.status === 'ACTIVE').length;
                const fullName = `${m.firstName} ${m.lastName}`;
                return (
                  <Tr key={m.id}>
                    <Td>
                      <span className="flex items-center gap-3">
                        <Avatar name={fullName} tone="muted" />
                        <Link href={`/members/${m.id}`} className="pui-link pui-surface">
                          {fullName}
                        </Link>
                        {m.isPartnerGuest && <Badge tone="info">{t('members.partnerGuest')}</Badge>}
                      </span>
                    </Td>
                    <Td className="ui-text-muted">{m.phone ?? '—'}</Td>
                    <Td>{active > 0 ? <Badge tone="success">{active}</Badge> : <span className="ui-text-muted">{t('members.noActivePackage')}</span>}</Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
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
