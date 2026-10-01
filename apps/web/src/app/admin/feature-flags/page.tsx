'use client';

import { useState } from 'react';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { useT } from '@/components/i18n/I18nProvider';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui/Table';

interface FeatureFlagRow {
  id: string;
  key: string;
  scope: 'GLOBAL' | 'BUSINESS_TYPE' | 'TENANT';
  enabled: boolean;
  businessTypeTemplate: { key: string; name: string } | null;
  studio: { name: string; slug: string } | null;
}

interface CatalogEntry {
  key: string;
  description: string;
}

export default function FeatureFlagsPage() {
  const t = useT();
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, error, forbidden } = useBff<{ items: FeatureFlagRow[] }>('admin/feature-flags', null, refreshKey);
  const { data: catalog } = useBff<{ items: CatalogEntry[] }>('admin/feature-flags/catalog', null, refreshKey);
  const [form, setForm] = useState({ key: '', scope: 'GLOBAL' as FeatureFlagRow['scope'], businessTypeTemplateId: '', studioId: '', enabled: true });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = () => setRefreshKey((k) => k + 1);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await bffFetch('admin/feature-flags', {
        method: 'POST',
        body: {
          key: form.key,
          scope: form.scope,
          enabled: form.enabled,
          ...(form.scope === 'BUSINESS_TYPE' ? { businessTypeTemplateId: form.businessTypeTemplateId } : {}),
          ...(form.scope === 'TENANT' ? { studioId: form.studioId } : {}),
        },
      });
      refresh();
    } catch (err) {
      setFormError(err instanceof BffError ? err.message : t('adminFeatureFlags.form.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  if (forbidden) return <EmptyState title={t('adminFeatureFlags.accessDenied')} />;

  return (
    <div className="grid gap-6" key={refreshKey}>
      <PageHeader
        title={t('adminFeatureFlags.title')}
        description={
          <>
            {t('adminFeatureFlags.subtitle')}
            {catalog && (
              <>
                <br />
                {t('adminFeatureFlags.knownKeys', { keys: catalog.items.map((c) => c.key).join(', ') })}
              </>
            )}
          </>
        }
      />

      <Card as="section">
        <form onSubmit={submit} className="pui-card-content">
          <h3 className="ui-heading">{t('adminFeatureFlags.form.title')}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input required placeholder={t('adminFeatureFlags.form.key')} value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} />
            <Select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as FeatureFlagRow['scope'] })}>
              <option value="GLOBAL">{t('adminFeatureFlags.form.scope.GLOBAL')}</option>
              <option value="BUSINESS_TYPE">{t('adminFeatureFlags.form.scope.BUSINESS_TYPE')}</option>
              <option value="TENANT">{t('adminFeatureFlags.form.scope.TENANT')}</option>
            </Select>
            {form.scope === 'BUSINESS_TYPE' && (
              <Input required className="sm:col-span-2" placeholder={t('adminFeatureFlags.form.businessTypeId')} value={form.businessTypeTemplateId} onChange={(e) => setForm({ ...form, businessTypeTemplateId: e.target.value })} />
            )}
            {form.scope === 'TENANT' && (
              <Input required className="sm:col-span-2" placeholder={t('adminFeatureFlags.form.studioId')} value={form.studioId} onChange={(e) => setForm({ ...form, studioId: e.target.value })} />
            )}
            <Checkbox className="sm:col-span-2" label={t('adminFeatureFlags.form.enabled')} checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
          </div>
          {formError && <p className="ui-caption ui-text-error">{formError}</p>}
          <Button type="submit" disabled={submitting} className="justify-self-start">
            {submitting ? t('adminFeatureFlags.form.submitting') : t('adminFeatureFlags.form.submit')}
          </Button>
        </form>
      </Card>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!data || data.items.length === 0) && <EmptyState title={t('adminFeatureFlags.empty')} />}
      {!loading && !error && data && data.items.length > 0 && (
        <Card className="overflow-x-auto">
          <Table>
            <Thead>
              <Tr>
                {[t('adminFeatureFlags.table.key'), t('adminFeatureFlags.table.scope'), t('adminFeatureFlags.table.target'), t('adminFeatureFlags.table.status')].map((h) => (
                  <Th key={h}>{h}</Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {data.items.map((f) => (
                <Tr key={f.id}>
                  <Td className="ui-strong">{f.key}</Td>
                  <Td>{f.scope}</Td>
                  <Td className="ui-text-muted">{f.businessTypeTemplate?.name ?? f.studio?.name ?? '-'}</Td>
                  <Td>
                    <Badge tone={f.enabled ? 'success' : 'muted'}>{f.enabled ? t('adminFeatureFlags.status.on') : t('adminFeatureFlags.status.off')}</Badge>
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
