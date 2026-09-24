'use client';

import { useState } from 'react';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, ErrorState, EmptyState } from '@/components/common/DataState';

interface MessageTemplateRow {
  id: string;
  studioId: string | null;
  key: string;
  channel: string;
  locale: string;
  isActive: boolean;
}
interface DocumentVersionRow {
  id: string;
  studioId: string | null;
  type: string;
  version: number;
  title: string;
  publishedAt: string | null;
}

const inputStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  borderColor: 'var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};

export default function ContentPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const { data: templates, loading: tLoading, error: tError } = useBff<{ items: MessageTemplateRow[] }>('admin/content/message-templates', null);
  const { data: docs, loading: dLoading, error: dError } = useBff<{ items: DocumentVersionRow[] }>('admin/content/document-versions', null);

  const [tplForm, setTplForm] = useState({ studioId: '', key: '', channel: 'SMS', body: '', whatsappTemplateName: '' });
  const [docForm, setDocForm] = useState({ studioId: '', type: 'KVKK_NOTICE', title: '', body: '' });
  const [tplError, setTplError] = useState<string | null>(null);
  const [docError, setDocError] = useState<string | null>(null);

  const refresh = () => setRefreshKey((k) => k + 1);

  const submitTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    setTplError(null);
    try {
      await bffFetch('admin/content/message-templates', {
        method: 'POST',
        body: {
          studioId: tplForm.studioId || null,
          key: tplForm.key,
          channel: tplForm.channel,
          locale: 'tr',
          body: tplForm.body,
          whatsappTemplateName: tplForm.whatsappTemplateName || undefined,
          isTransactional: true,
          isActive: true,
        },
      });
      refresh();
    } catch (err) {
      setTplError(err instanceof BffError ? err.message : 'Kaydedilemedi');
    }
  };

  const submitDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    setDocError(null);
    try {
      await bffFetch('admin/content/document-versions', {
        method: 'POST',
        body: { studioId: docForm.studioId || null, type: docForm.type, title: docForm.title, body: docForm.body },
      });
      refresh();
    } catch (err) {
      setDocError(err instanceof BffError ? err.message : 'Yayınlanamadı');
    }
  };

  return (
    <div className="space-y-10" key={refreshKey}>
      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-bold">Mesaj Şablonları</h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            İşletme (studio) ID boş bırakılırsa global varsayılan şablon güncellenir
          </p>
        </div>
        <form onSubmit={submitTemplate} className="p-5 border space-y-3" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="İşletme ID (boş = global)" value={tplForm.studioId} onChange={(e) => setTplForm({ ...tplForm, studioId: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle} />
            <input required placeholder="Anahtar (ör: BOOKING_REMINDER)" value={tplForm.key} onChange={(e) => setTplForm({ ...tplForm, key: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle} />
            <select value={tplForm.channel} onChange={(e) => setTplForm({ ...tplForm, channel: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle}>
              <option value="SMS">SMS</option>
              <option value="WHATSAPP">WhatsApp</option>
              <option value="PUSH">Push</option>
              <option value="EMAIL">E-posta</option>
            </select>
            {tplForm.channel === 'WHATSAPP' && (
              <input required placeholder="Onaylı WhatsApp şablon adı" value={tplForm.whatsappTemplateName} onChange={(e) => setTplForm({ ...tplForm, whatsappTemplateName: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle} />
            )}
            <textarea required placeholder="Şablon metni ({{placeholder}} kullanılabilir)" value={tplForm.body} onChange={(e) => setTplForm({ ...tplForm, body: e.target.value })} className="border px-3 py-2 text-sm col-span-2" style={inputStyle} rows={2} />
          </div>
          {tplError && <p className="text-xs" style={{ color: 'var(--color-danger)' }}>{tplError}</p>}
          <button type="submit" className="px-4 py-2 text-sm font-medium" style={{ borderRadius: 'var(--radius-button)', backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>
            Kaydet
          </button>
        </form>
        {tLoading && <LoadingState />}
        {tError && <ErrorState message={tError} />}
        {!tLoading && !tError && (!templates || templates.items.length === 0) && <EmptyState title="Henüz şablon yok" />}
        {!tLoading && !tError && templates && templates.items.length > 0 && (
          <ul className="text-sm space-y-1" style={{ color: 'var(--color-text-secondary)' }}>
            {templates.items.map((t) => (
              <li key={t.id}>
                {t.key} · {t.channel} · {t.studioId ? 'kiracı override' : 'global'} {t.isActive ? '' : '(pasif)'}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-bold">Belge Sürümleri</h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            Sözleşme/KVKK metinleri; her yayın yeni bir sürüm ekler, önceki sürümler değişmez
          </p>
        </div>
        <form onSubmit={submitDocument} className="p-5 border space-y-3" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="İşletme ID (boş = global)" value={docForm.studioId} onChange={(e) => setDocForm({ ...docForm, studioId: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle} />
            <select value={docForm.type} onChange={(e) => setDocForm({ ...docForm, type: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle}>
              <option value="KVKK_NOTICE">KVKK Aydınlatma Metni</option>
              <option value="MEMBERSHIP_CONTRACT">Üyelik Sözleşmesi</option>
              <option value="EXPLICIT_CONSENT">Açık Rıza Metni</option>
              <option value="HEALTH_WAIVER">Sağlık Beyanı</option>
              <option value="HEALTH_DATA">Sağlık Verisi Paylaşım Rızası</option>
            </select>
            <input required placeholder="Başlık" value={docForm.title} onChange={(e) => setDocForm({ ...docForm, title: e.target.value })} className="border px-3 py-2 text-sm col-span-2" style={inputStyle} />
            <textarea required placeholder="Metin" value={docForm.body} onChange={(e) => setDocForm({ ...docForm, body: e.target.value })} className="border px-3 py-2 text-sm col-span-2" style={inputStyle} rows={4} />
          </div>
          {docError && <p className="text-xs" style={{ color: 'var(--color-danger)' }}>{docError}</p>}
          <button type="submit" className="px-4 py-2 text-sm font-medium" style={{ borderRadius: 'var(--radius-button)', backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>
            Yeni Sürüm Yayınla
          </button>
        </form>
        {dLoading && <LoadingState />}
        {dError && <ErrorState message={dError} />}
        {!dLoading && !dError && (!docs || docs.items.length === 0) && <EmptyState title="Henüz belge yok" />}
        {!dLoading && !dError && docs && docs.items.length > 0 && (
          <ul className="text-sm space-y-1" style={{ color: 'var(--color-text-secondary)' }}>
            {docs.items.map((d) => (
              <li key={d.id}>
                {d.title} · {d.type} v{d.version} · {d.studioId ? 'kiracı' : 'global'} {d.publishedAt ? '' : '(taslak)'}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
