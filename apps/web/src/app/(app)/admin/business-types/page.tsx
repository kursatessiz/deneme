'use client';

import { useState } from 'react';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { useT } from '@/components/i18n/I18nProvider';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';

interface BusinessType {
  id: string;
  key: string;
  name: string;
  enabledModules: string[];
  isActive: boolean;
}

export default function BusinessTypesPage() {
  const t = useT();
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, error, forbidden } = useBff<{ items: BusinessType[] }>('admin/business-type-templates', null, refreshKey);
  const [form, setForm] = useState({ key: '', name: '', serviceTypeNames: '', resourceTypeNames: '', enabledModules: '' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = () => setRefreshKey((k) => k + 1);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await bffFetch('admin/business-type-templates', {
        method: 'POST',
        body: {
          key: form.key,
          name: form.name,
          vocabulary: {},
          defaults: {
            serviceTypeNames: form.serviceTypeNames.split(',').map((s) => s.trim()).filter(Boolean),
            resourceTypeNames: form.resourceTypeNames.split(',').map((s) => s.trim()).filter(Boolean),
          },
          enabledModules: form.enabledModules.split(',').map((s) => s.trim()).filter(Boolean),
          isActive: true,
        },
      });
      setForm({ key: '', name: '', serviceTypeNames: '', resourceTypeNames: '', enabledModules: '' });
      refresh();
    } catch (err) {
      setFormError(err instanceof BffError ? err.message : t('adminBusinessTypes.form.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  if (forbidden) return <EmptyState title={t('adminBusinessTypes.accessDenied')} />;

  return (
    <div className="grid gap-6" key={refreshKey}>
      <PageHeader title={t('adminBusinessTypes.title')} description={t('adminBusinessTypes.subtitle')} />

      <Card as="section">
        <form onSubmit={submit} className="pui-card-content">
          <h3 className="ui-heading">{t('adminBusinessTypes.form.title')}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input required placeholder={t('adminBusinessTypes.form.key')} value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} />
            <Input required placeholder={t('adminBusinessTypes.form.name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input placeholder={t('adminBusinessTypes.form.serviceTypes')} value={form.serviceTypeNames} onChange={(e) => setForm({ ...form, serviceTypeNames: e.target.value })} />
            <Input placeholder={t('adminBusinessTypes.form.resourceTypes')} value={form.resourceTypeNames} onChange={(e) => setForm({ ...form, resourceTypeNames: e.target.value })} />
            <Input className="sm:col-span-2" placeholder={t('adminBusinessTypes.form.enabledModules')} value={form.enabledModules} onChange={(e) => setForm({ ...form, enabledModules: e.target.value })} />
          </div>
          {formError && <p className="ui-caption ui-text-error">{formError}</p>}
          <Button type="submit" disabled={submitting} className="justify-self-start">
            {submitting ? t('adminBusinessTypes.form.submitting') : t('adminBusinessTypes.form.submit')}
          </Button>
        </form>
      </Card>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {data.items.map((bt) => (
            <Card key={bt.id}>
              <CardContent>
                <div className="grid gap-1">
                  <h3 className="ui-heading">{bt.name}</h3>
                  <p className="ui-caption">{bt.key}</p>
                </div>
                <p className="ui-small">{t('adminBusinessTypes.modules', { modules: bt.enabledModules.join(', ') || '-' })}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
