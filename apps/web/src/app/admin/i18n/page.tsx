'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { AdminLanguageDTO } from '@platform/shared';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, ErrorState } from '@/components/common/DataState';
import { useT } from '@/components/i18n/I18nProvider';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { LinkButton } from '@/components/ui/LinkButton';
import { PageHeader } from '@/components/ui/PageHeader';
import { Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui/Table';

function CompletionBar({ completion }: { completion: number }) {
  const pct = Math.round(completion * 100);
  return (
    <div className="flex items-center gap-2 w-40">
      <div className="flex-1 h-1.5 overflow-hidden ui-panel">
        <div className="h-full ui-bar-fill" data-level={pct === 100 ? 'complete' : undefined} style={{ width: `${pct}%` }} />
      </div>
      <span className="ui-caption tabular-nums">{pct}%</span>
    </div>
  );
}

export default function AdminI18nPage() {
  const t = useT();
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, error } = useBff<{ items: AdminLanguageDTO[] }>('admin/i18n/languages', null, refreshKey);
  const [form, setForm] = useState({ code: '', name: '', nativeName: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const refresh = () => setRefreshKey((k) => k + 1);

  async function createLanguage(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await bffFetch('admin/i18n/languages', { method: 'POST', body: form });
      setForm({ code: '', name: '', nativeName: '' });
      refresh();
    } catch (err) {
      setFormError(err instanceof BffError ? err.message : t('adminI18n.createError'));
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleEnabled(lang: AdminLanguageDTO) {
    await bffFetch(`admin/i18n/languages/${lang.code}`, { method: 'PUT', body: { isEnabled: !lang.isEnabled } }).catch(() => undefined);
    refresh();
  }

  async function deleteLanguage(code: string) {
    await bffFetch(`admin/i18n/languages/${code}`, { method: 'DELETE' }).catch(() => undefined);
    setPendingDelete(null);
    refresh();
  }

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;

  const items = data?.items ?? [];

  return (
    <div className="grid gap-6" key={refreshKey}>
      <PageHeader title={t('adminI18n.title')} description={t('adminI18n.subtitle')} />

      <Card className="overflow-x-auto">
        <Table>
          <Thead>
            <Tr>
              <Th>{t('adminI18n.code')}</Th>
              <Th>{t('adminI18n.name')}</Th>
              <Th>{t('adminI18n.completion')}</Th>
              <Th>{t('adminI18n.enabled')}</Th>
              <Th className="text-right">{t('adminI18n.actions')}</Th>
            </Tr>
          </Thead>
          <Tbody>
            {items.map((lang) => (
              <Tr key={lang.code}>
                <Td className="ui-mono">{lang.code}</Td>
                <Td>
                  <Link href={`/admin/i18n/${lang.code}`} className="pui-link pui-theme ui-strong">
                    {lang.name}
                  </Link>
                  <span className="ui-caption"> ({lang.nativeName})</span>
                </Td>
                <Td>
                  <CompletionBar completion={lang.completion} />
                </Td>
                <Td>
                  <Badge tone={lang.isEnabled ? 'success' : 'muted'}>{lang.isEnabled ? t('adminI18n.enabled') : t('adminI18n.disabled')}</Badge>
                </Td>
                <Td className="text-right">
                  <span className="inline-flex flex-wrap items-center justify-end gap-2">
                    <LinkButton href={`/admin/i18n/${lang.code}`} variant="link" size="sm">
                      {t('adminI18n.open')}
                    </LinkButton>
                    <Button
                      variant="link"
                      tone="surface"
                      size="sm"
                      onClick={() => toggleEnabled(lang)}
                      disabled={lang.isBase && lang.isEnabled}
                      title={lang.isBase ? t('adminI18n.cannotDisableBase') : undefined}
                    >
                      {lang.isEnabled ? t('adminI18n.disable') : t('adminI18n.enable')}
                    </Button>
                    {!lang.isBundled &&
                      (pendingDelete === lang.code ? (
                        <span className="inline-flex flex-wrap items-center gap-2">
                          <span className="ui-small ui-text-error">{t('adminI18n.deleteConfirmMessage', { name: lang.name })}</span>
                          <Button variant="link" tone="error" size="sm" onClick={() => deleteLanguage(lang.code)}>
                            {t('adminI18n.deleteConfirm')}
                          </Button>
                          <Button variant="link" tone="muted" size="sm" onClick={() => setPendingDelete(null)}>
                            {t('common.cancel')}
                          </Button>
                        </span>
                      ) : (
                        <Button variant="link" tone="error" size="sm" onClick={() => setPendingDelete(lang.code)}>
                          {t('adminI18n.delete')}
                        </Button>
                      ))}
                  </span>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Card>

      <Card as="section" className="max-w-lg">
        <CardContent>
          <h3 className="ui-heading">{t('adminI18n.addLanguage')}</h3>
          <form onSubmit={createLanguage} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input required placeholder={t('adminI18n.code')} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.trim() })} />
            <Input required placeholder={t('adminI18n.name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input required placeholder={t('adminI18n.nativeName')} value={form.nativeName} onChange={(e) => setForm({ ...form, nativeName: e.target.value })} />
            <Button type="submit" disabled={submitting} className="sm:col-span-3">
              {t('adminI18n.addLanguage')}
            </Button>
          </form>
          {formError && <p className="ui-caption ui-text-error">{formError}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
