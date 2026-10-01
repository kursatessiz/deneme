'use client';

import { useEffect, useState } from 'react';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, ErrorState } from '@/components/common/DataState';
import { InlineMessage, PrimaryButton, Section, TextField } from '@/components/settings/ui';
import { SiteEditor } from '@/components/sites/SiteEditor';
import { ArticleEditor } from '@/components/sites/ArticleEditor';
import { Tabs } from '@/components/ui';
import { PageHeader } from '@/components/ui/PageHeader';
import { useT } from '@/components/i18n/I18nProvider';

interface CompanyInfo {
  legalName: string;
  address: string | null;
  tradeRegistryNo: string | null;
  mersisNo: string | null;
  taxOffice: string | null;
  taxNumber: string | null;
  email: string | null;
  phone: string | null;
  socialLinks: Record<string, string>;
}

function CompanyInfoForm() {
  const t = useT();
  const [info, setInfo] = useState<CompanyInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageOk, setMessageOk] = useState(false);

  useEffect(() => {
    bffFetch<CompanyInfo>('admin/company-info')
      .then(setInfo)
      .catch((err) => setError(err instanceof BffError ? err.message : t('adminWebSitesi.companyInfo.loadFailed')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!info) return <LoadingState />;

  const save = async () => {
    setMessage(null);
    try {
      await bffFetch('admin/company-info', { method: 'PUT', body: info });
      setMessageOk(true);
      setMessage(t('adminWebSitesi.companyInfo.saved'));
    } catch (err) {
      setMessageOk(false);
      setMessage(err instanceof BffError ? err.message : t('adminWebSitesi.companyInfo.saveFailed'));
    }
  };

  return (
    <Section title={t('adminWebSitesi.companyInfo.title')} description={t('adminWebSitesi.companyInfo.description')}>
      <div className="grid grid-cols-2 gap-3">
        <TextField label={t('adminWebSitesi.companyInfo.legalName')} value={info.legalName} onChange={(v) => setInfo({ ...info, legalName: v })} />
        <TextField label={t('adminWebSitesi.companyInfo.taxOffice')} value={info.taxOffice ?? ''} onChange={(v) => setInfo({ ...info, taxOffice: v })} />
        <TextField label={t('adminWebSitesi.companyInfo.taxNumber')} value={info.taxNumber ?? ''} onChange={(v) => setInfo({ ...info, taxNumber: v })} />
        <TextField label={t('adminWebSitesi.companyInfo.tradeRegistryNo')} value={info.tradeRegistryNo ?? ''} onChange={(v) => setInfo({ ...info, tradeRegistryNo: v })} />
        <TextField label={t('adminWebSitesi.companyInfo.mersisNo')} value={info.mersisNo ?? ''} onChange={(v) => setInfo({ ...info, mersisNo: v })} />
        <TextField label={t('adminWebSitesi.companyInfo.email')} value={info.email ?? ''} onChange={(v) => setInfo({ ...info, email: v })} />
        <TextField label={t('adminWebSitesi.companyInfo.phone')} value={info.phone ?? ''} onChange={(v) => setInfo({ ...info, phone: v })} />
        <TextField label={t('adminWebSitesi.companyInfo.address')} value={info.address ?? ''} onChange={(v) => setInfo({ ...info, address: v })} />
      </div>
      {message && <InlineMessage text={message} tone={messageOk ? 'success' : 'error'} />}
      <PrimaryButton onClick={save}>{t('adminWebSitesi.companyInfo.submit')}</PrimaryButton>
    </Section>
  );
}

export default function AdminWebSitesiPage() {
  const t = useT();
  const [studioId, setStudioId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'pages' | 'articles'>('pages');

  useEffect(() => {
    bffFetch<{ studioId: string }>('admin/company-info/platform-studio-id')
      .then((r) => setStudioId(r.studioId))
      .catch((err) => setError(err instanceof BffError ? err.message : t('adminWebSitesi.notFound')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid gap-8">
      <PageHeader title={t('adminWebSitesi.title')} description={t('adminWebSitesi.subtitle')} />
      <CompanyInfoForm />
      {error && <ErrorState message={error} />}
      {!error && !studioId && <LoadingState />}
      {studioId && (
        <>
          <Tabs
            tabs={[
              { key: 'pages', label: t('articles.editor.tab.pages') },
              { key: 'articles', label: t('articles.editor.tab.articles') },
            ]}
            active={tab}
            onChange={(key) => setTab(key === 'articles' ? 'articles' : 'pages')}
            label={t('adminWebSitesi.title')}
          />
          {tab === 'pages' ? <SiteEditor studioId={studioId} variant="platform" /> : <ArticleEditor studioId={studioId} variant="platform" />}
        </>
      )}
    </div>
  );
}
