'use client';

import { useState } from 'react';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { useT } from '@/components/i18n/I18nProvider';
import { TenantBillingActions } from '@/components/admin/TenantBillingActions';
import { TenantThemeFamilies } from '@/components/admin/TenantThemeFamilies';
import type { TenantListItemDTO } from '@platform/shared';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui/Table';

type TenantListItem = TenantListItemDTO;

/** Countries with explicit region defaults (packages/shared countryDefaultsOf); any other ISO code is also
 * accepted by the API and falls back to USD/UTC/NONE/en, completed later from the studio's region settings. */
const COUNTRY_CODES = ['TR', 'US', 'CA', 'GB', 'DE', 'FR', 'ES', 'IT', 'NL', 'AE'] as const;

function CreateTenantForm({ onCreated }: { onCreated: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    slug: '',
    businessTypeTemplateKey: '',
    planKey: '',
    countryCode: 'TR',
    ownerFirstName: '',
    ownerLastName: '',
    ownerPhone: '',
    referralCode: '',
  });

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await bffFetch('admin/tenants', { method: 'POST', body: { ...form, ownerChannel: 'SHOWN' } });
      setOpen(false);
      setForm({ name: '', slug: '', businessTypeTemplateKey: '', planKey: '', countryCode: 'TR', ownerFirstName: '', ownerLastName: '', ownerPhone: '', referralCode: '' });
      onCreated();
    } catch (err) {
      setError(err instanceof BffError ? err.message : t('adminTenants.form.createFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} className="justify-self-start">
        {t('adminTenants.createButton')}
      </Button>
    );
  }

  return (
    <Card as="section">
      <form onSubmit={submit} className="pui-card-content">
        <h3 className="ui-heading">{t('adminTenants.form.title')}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input required placeholder={t('adminTenants.form.name')} value={form.name} onChange={set('name')} />
          <Input required placeholder={t('adminTenants.form.slug')} value={form.slug} onChange={set('slug')} />
          <Input required placeholder={t('adminTenants.form.businessType')} value={form.businessTypeTemplateKey} onChange={set('businessTypeTemplateKey')} />
          <Input required placeholder={t('adminTenants.form.plan')} value={form.planKey} onChange={set('planKey')} />
          <Select required value={form.countryCode} onChange={set('countryCode')}>
            {COUNTRY_CODES.map((code) => (
              <option key={code} value={code}>
                {t(`adminTenants.country.${code}`)}
              </option>
            ))}
          </Select>
          <Input required placeholder={t('adminTenants.form.ownerFirstName')} value={form.ownerFirstName} onChange={set('ownerFirstName')} />
          <Input required placeholder={t('adminTenants.form.ownerLastName')} value={form.ownerLastName} onChange={set('ownerLastName')} />
          <Input required placeholder={t('adminTenants.form.ownerPhone')} value={form.ownerPhone} onChange={set('ownerPhone')} />
          <Input placeholder={t('adminTenants.form.referralCode')} value={form.referralCode} onChange={set('referralCode')} />
        </div>
        {error && <p className="ui-caption ui-text-error">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? t('adminTenants.form.submitting') : t('adminTenants.form.submit')}
          </Button>
          <Button variant="link" tone="surface" onClick={() => setOpen(false)}>
            {t('adminTenants.form.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function TenantsPage() {
  const t = useT();
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, error, forbidden } = useBff<{ items: TenantListItem[] }>('admin/tenants', null, refreshKey);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = () => setRefreshKey((k) => k + 1);

  const toggleActive = async (tenant: TenantListItem) => {
    setActionError(null);
    try {
      await bffFetch(`admin/tenants/${tenant.id}/${tenant.isActive ? 'suspend' : 'reactivate'}`, { method: 'POST' });
      refresh();
    } catch (err) {
      setActionError(err instanceof BffError ? err.message : t('adminTenants.actionFailed'));
    }
  };

  if (forbidden) return <EmptyState title={t('adminTenants.accessDeniedTitle')} description={t('adminTenants.accessDeniedDescription')} />;

  const columns = [
    t('adminTenants.table.name'),
    t('adminTenants.table.slug'),
    t('adminTenants.table.businessType'),
    t('adminTenants.table.plan'),
    t('adminTenants.table.branches'),
    t('adminTenants.table.members'),
    t('adminTenants.table.staff'),
    t('adminTenants.table.status'),
    t('adminBilling.tenants.billing'),
    t('themeDesign.admin.title'),
    '',
  ];

  return (
    <div className="grid gap-6" key={refreshKey}>
      <PageHeader title={t('adminTenants.title')} description={t('adminTenants.subtitle')} />

      <CreateTenantForm onCreated={refresh} />
      {actionError && <p className="ui-caption ui-text-error">{actionError}</p>}

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!data || data.items.length === 0) && <EmptyState title={t('adminTenants.empty')} />}
      {!loading && !error && data && data.items.length > 0 && (
        <Card className="overflow-x-auto">
          <Table>
            <Thead>
              <Tr>
                {columns.map((h, i) => (
                  <Th key={i}>{h}</Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {data.items.map((tenant) => (
                <Tr key={tenant.id}>
                  <Td className="ui-strong">{tenant.name}</Td>
                  <Td className="ui-text-muted">{tenant.slug}</Td>
                  <Td>{tenant.businessTypeTemplateKey ?? '-'}</Td>
                  <Td>
                    {tenant.planKey ?? '-'} {tenant.subscriptionStatus ? `(${tenant.subscriptionStatus})` : ''}
                  </Td>
                  <Td>{tenant.branchCount}</Td>
                  <Td>{tenant.activeMemberCount}</Td>
                  <Td>{tenant.staffCount}</Td>
                  <Td>
                    <Badge tone={tenant.isActive ? 'muted' : 'error'} variant={tenant.isActive ? 'soft' : 'solid'}>
                      {tenant.isActive ? t('adminTenants.status.active') : t('adminTenants.status.suspended')}
                    </Badge>
                  </Td>
                  <Td className="align-top">
                    <TenantBillingActions
                      studioId={tenant.id}
                      status={tenant.billingStatus}
                      trialEndsAt={tenant.trialEndsAt}
                      countryCode={tenant.countryCode}
                      billingCurrency={tenant.billingCurrency}
                      billingCurrencyOverride={tenant.billingCurrencyOverride}
                      onChanged={refresh}
                    />
                  </Td>
                  <Td className="align-top">
                    <TenantThemeFamilies studioId={tenant.id} />
                  </Td>
                  <Td>
                    <Button variant="link" tone="surface" size="sm" onClick={() => toggleActive(tenant)}>
                      {tenant.isActive ? t('adminTenants.suspend') : t('adminTenants.reactivate')}
                    </Button>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
