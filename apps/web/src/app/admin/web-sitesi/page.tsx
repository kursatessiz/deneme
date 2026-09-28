'use client';

import { useEffect, useState } from 'react';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, ErrorState } from '@/components/common/DataState';
import { InlineMessage, PrimaryButton, Section, TextField } from '@/components/settings/ui';
import { SiteEditor } from '@/components/sites/SiteEditor';

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
  const [info, setInfo] = useState<CompanyInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    bffFetch<CompanyInfo>('admin/company-info')
      .then(setInfo)
      .catch((err) => setError(err instanceof BffError ? err.message : 'Yüklenemedi'));
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!info) return <LoadingState />;

  const save = async () => {
    setMessage(null);
    try {
      await bffFetch('admin/company-info', { method: 'PUT', body: info });
      setMessage('Şirket bilgileri kaydedildi');
    } catch (err) {
      setMessage(err instanceof BffError ? err.message : 'Kaydedilemedi');
    }
  };

  return (
    <Section title="Şirket bilgileri" description="Yasal metinlerde ve iletişim bloklarında kullanılan platform kimliği">
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Unvan" value={info.legalName} onChange={(v) => setInfo({ ...info, legalName: v })} />
        <TextField label="Vergi dairesi" value={info.taxOffice ?? ''} onChange={(v) => setInfo({ ...info, taxOffice: v })} />
        <TextField label="Vergi numarası" value={info.taxNumber ?? ''} onChange={(v) => setInfo({ ...info, taxNumber: v })} />
        <TextField label="Ticaret sicil no" value={info.tradeRegistryNo ?? ''} onChange={(v) => setInfo({ ...info, tradeRegistryNo: v })} />
        <TextField label="MERSİS no" value={info.mersisNo ?? ''} onChange={(v) => setInfo({ ...info, mersisNo: v })} />
        <TextField label="E-posta" value={info.email ?? ''} onChange={(v) => setInfo({ ...info, email: v })} />
        <TextField label="Telefon" value={info.phone ?? ''} onChange={(v) => setInfo({ ...info, phone: v })} />
        <TextField label="Adres" value={info.address ?? ''} onChange={(v) => setInfo({ ...info, address: v })} />
      </div>
      {message && <InlineMessage text={message} tone={message.includes('kaydedildi') ? 'success' : 'error'} />}
      <PrimaryButton onClick={save}>Kaydet</PrimaryButton>
    </Section>
  );
}

export default function AdminWebSitesiPage() {
  const [studioId, setStudioId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    bffFetch<{ studioId: string }>('admin/company-info/platform-studio-id')
      .then((r) => setStudioId(r.studioId))
      .catch((err) => setError(err instanceof BffError ? err.message : 'Platform sitesi bulunamadı'));
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
          Web Sitesi
        </h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          Platformun kurumsal ve pazarlama sitesi: ana sayfa, sektör açılış sayfaları, yasal metinler
        </p>
      </div>
      <CompanyInfoForm />
      {error && <ErrorState message={error} />}
      {!error && !studioId && <LoadingState />}
      {studioId && <SiteEditor studioId={studioId} variant="platform" />}
    </div>
  );
}
