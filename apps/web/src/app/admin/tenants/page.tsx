'use client';

import { useState } from 'react';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { useT } from '@/components/i18n/I18nProvider';
import { TenantBillingActions } from '@/components/admin/TenantBillingActions';
import type { StudioBillingStatus } from '@platform/shared';

interface TenantListItem {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  businessTypeTemplateKey: string | null;
  planKey: string | null;
  subscriptionStatus: string | null;
  branchCount: number;
  activeMemberCount: number;
  staffCount: number;
  billingStatus: StudioBillingStatus;
  trialEndsAt: string | null;
}

const inputStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  borderColor: 'var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};

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
      <button
        onClick={() => setOpen(true)}
        className="px-4 py-2 text-sm font-medium"
        style={{ borderRadius: 'var(--radius-button)', backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }}
      >
        {t('adminTenants.createButton')}
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="p-5 border space-y-3"
      style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
    >
      <h3 className="text-sm font-semibold">{t('adminTenants.form.title')}</h3>
      <div className="grid grid-cols-2 gap-3">
        <input required placeholder={t('adminTenants.form.name')} value={form.name} onChange={set('name')} className="border px-3 py-2 text-sm" style={inputStyle} />
        <input required placeholder={t('adminTenants.form.slug')} value={form.slug} onChange={set('slug')} className="border px-3 py-2 text-sm" style={inputStyle} />
        <input
          required
          placeholder={t('adminTenants.form.businessType')}
          value={form.businessTypeTemplateKey}
          onChange={set('businessTypeTemplateKey')}
          className="border px-3 py-2 text-sm"
          style={inputStyle}
        />
        <input required placeholder={t('adminTenants.form.plan')} value={form.planKey} onChange={set('planKey')} className="border px-3 py-2 text-sm" style={inputStyle} />
        <select required value={form.countryCode} onChange={set('countryCode')} className="border px-3 py-2 text-sm" style={inputStyle}>
          {COUNTRY_CODES.map((code) => (
            <option key={code} value={code}>
              {t(`adminTenants.country.${code}`)}
            </option>
          ))}
        </select>
        <input required placeholder={t('adminTenants.form.ownerFirstName')} value={form.ownerFirstName} onChange={set('ownerFirstName')} className="border px-3 py-2 text-sm" style={inputStyle} />
        <input required placeholder={t('adminTenants.form.ownerLastName')} value={form.ownerLastName} onChange={set('ownerLastName')} className="border px-3 py-2 text-sm" style={inputStyle} />
        <input required placeholder={t('adminTenants.form.ownerPhone')} value={form.ownerPhone} onChange={set('ownerPhone')} className="border px-3 py-2 text-sm" style={inputStyle} />
        <input placeholder={t('adminTenants.form.referralCode')} value={form.referralCode} onChange={set('referralCode')} className="border px-3 py-2 text-sm" style={inputStyle} />
      </div>
      {error && <p className="text-xs" style={{ color: 'var(--color-danger)' }}>{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 text-sm font-medium"
          style={{ borderRadius: 'var(--radius-button)', backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }}
        >
          {submitting ? t('adminTenants.form.submitting') : t('adminTenants.form.submit')}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          {t('adminTenants.form.cancel')}
        </button>
      </div>
    </form>
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
    '',
  ];

  return (
    <div className="space-y-6" key={refreshKey}>
      <div>
        <h2 className="text-xl font-bold">{t('adminTenants.title')}</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          {t('adminTenants.subtitle')}
        </p>
      </div>

      <CreateTenantForm onCreated={refresh} />
      {actionError && <p className="text-xs" style={{ color: 'var(--color-danger)' }}>{actionError}</p>}

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!data || data.items.length === 0) && <EmptyState title={t('adminTenants.empty')} />}
      {!loading && !error && data && data.items.length > 0 && (
        <div className="overflow-x-auto border" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--color-surface-muted)' }}>
                {columns.map((h, i) => (
                  <th key={i} className="text-left px-3 py-2 font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.map((tenant) => (
                <tr key={tenant.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="px-3 py-2 font-medium">{tenant.name}</td>
                  <td className="px-3 py-2" style={{ color: 'var(--color-text-muted)' }}>{tenant.slug}</td>
                  <td className="px-3 py-2">{tenant.businessTypeTemplateKey ?? '-'}</td>
                  <td className="px-3 py-2">{tenant.planKey ?? '-'} {tenant.subscriptionStatus ? `(${tenant.subscriptionStatus})` : ''}</td>
                  <td className="px-3 py-2">{tenant.branchCount}</td>
                  <td className="px-3 py-2">{tenant.activeMemberCount}</td>
                  <td className="px-3 py-2">{tenant.staffCount}</td>
                  <td className="px-3 py-2">
                    <span
                      className="px-2 py-0.5 text-xs font-medium"
                      style={{
                        borderRadius: 'var(--radius-chip)',
                        backgroundColor: tenant.isActive ? 'var(--color-surface-muted)' : 'var(--color-danger)',
                        color: tenant.isActive ? 'var(--color-text-secondary)' : 'var(--color-on-primary)',
                      }}
                    >
                      {tenant.isActive ? t('adminTenants.status.active') : t('adminTenants.status.suspended')}
                    </span>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <TenantBillingActions studioId={tenant.id} status={tenant.billingStatus} trialEndsAt={tenant.trialEndsAt} onChanged={refresh} />
                  </td>
                  <td className="px-3 py-2">
                    <button onClick={() => toggleActive(tenant)} className="text-xs font-medium underline" style={{ color: 'var(--color-text-secondary)' }}>
                      {tenant.isActive ? t('adminTenants.suspend') : t('adminTenants.reactivate')}
                    </button>
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
