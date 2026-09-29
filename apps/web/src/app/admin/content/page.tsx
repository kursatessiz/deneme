'use client';

import { useState } from 'react';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, ErrorState, EmptyState } from '@/components/common/DataState';
import { useT } from '@/components/i18n/I18nProvider';

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
  const t = useT();
  const [refreshKey, setRefreshKey] = useState(0);
  const { data: templates, loading: tLoading, error: tError } = useBff<{ items: MessageTemplateRow[] }>('admin/content/message-templates', null, refreshKey);
  const { data: docs, loading: dLoading, error: dError } = useBff<{ items: DocumentVersionRow[] }>('admin/content/document-versions', null, refreshKey);

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
      setTplError(err instanceof BffError ? err.message : t('adminContent.templates.saveFailed'));
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
      setDocError(err instanceof BffError ? err.message : t('adminContent.documents.saveFailed'));
    }
  };

  return (
    <div className="space-y-10" key={refreshKey}>
      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-bold">{t('adminContent.templates.title')}</h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            {t('adminContent.templates.subtitle')}
          </p>
        </div>
        <form onSubmit={submitTemplate} className="p-5 border space-y-3" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
          <div className="grid grid-cols-2 gap-3">
            <input placeholder={t('adminContent.templates.studioId')} value={tplForm.studioId} onChange={(e) => setTplForm({ ...tplForm, studioId: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle} />
            <input required placeholder={t('adminContent.templates.key')} value={tplForm.key} onChange={(e) => setTplForm({ ...tplForm, key: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle} />
            <select value={tplForm.channel} onChange={(e) => setTplForm({ ...tplForm, channel: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle}>
              <option value="SMS">{t('adminContent.templates.channel.SMS')}</option>
              <option value="WHATSAPP">{t('adminContent.templates.channel.WHATSAPP')}</option>
              <option value="PUSH">{t('adminContent.templates.channel.PUSH')}</option>
              <option value="EMAIL">{t('adminContent.templates.channel.EMAIL')}</option>
            </select>
            {tplForm.channel === 'WHATSAPP' && (
              <input required placeholder={t('adminContent.templates.whatsappName')} value={tplForm.whatsappTemplateName} onChange={(e) => setTplForm({ ...tplForm, whatsappTemplateName: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle} />
            )}
            <textarea required placeholder={t('adminContent.templates.body')} value={tplForm.body} onChange={(e) => setTplForm({ ...tplForm, body: e.target.value })} className="border px-3 py-2 text-sm col-span-2" style={inputStyle} rows={2} />
          </div>
          {tplError && <p className="text-xs" style={{ color: 'var(--color-danger)' }}>{tplError}</p>}
          <button type="submit" className="px-4 py-2 text-sm font-medium" style={{ borderRadius: 'var(--radius-button)', backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>
            {t('adminContent.templates.submit')}
          </button>
        </form>
        {tLoading && <LoadingState />}
        {tError && <ErrorState message={tError} />}
        {!tLoading && !tError && (!templates || templates.items.length === 0) && <EmptyState title={t('adminContent.templates.empty')} />}
        {!tLoading && !tError && templates && templates.items.length > 0 && (
          <ul className="text-sm space-y-1" style={{ color: 'var(--color-text-secondary)' }}>
            {templates.items.map((tpl) => (
              <li key={tpl.id}>
                {tpl.key} · {tpl.channel} · {tpl.studioId ? t('adminContent.templates.rowScope.tenant') : t('adminContent.templates.rowScope.global')}{' '}
                {tpl.isActive ? '' : t('adminContent.templates.rowInactive')}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-bold">{t('adminContent.documents.title')}</h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            {t('adminContent.documents.subtitle')}
          </p>
        </div>
        <form onSubmit={submitDocument} className="p-5 border space-y-3" style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
          <div className="grid grid-cols-2 gap-3">
            <input placeholder={t('adminContent.documents.studioId')} value={docForm.studioId} onChange={(e) => setDocForm({ ...docForm, studioId: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle} />
            <select value={docForm.type} onChange={(e) => setDocForm({ ...docForm, type: e.target.value })} className="border px-3 py-2 text-sm" style={inputStyle}>
              <option value="KVKK_NOTICE">{t('adminContent.documents.type.KVKK_NOTICE')}</option>
              <option value="MEMBERSHIP_CONTRACT">{t('adminContent.documents.type.MEMBERSHIP_CONTRACT')}</option>
              <option value="EXPLICIT_CONSENT">{t('adminContent.documents.type.EXPLICIT_CONSENT')}</option>
              <option value="HEALTH_WAIVER">{t('adminContent.documents.type.HEALTH_WAIVER')}</option>
              <option value="HEALTH_DATA">{t('adminContent.documents.type.HEALTH_DATA')}</option>
            </select>
            <input required placeholder={t('adminContent.documents.titleField')} value={docForm.title} onChange={(e) => setDocForm({ ...docForm, title: e.target.value })} className="border px-3 py-2 text-sm col-span-2" style={inputStyle} />
            <textarea required placeholder={t('adminContent.documents.body')} value={docForm.body} onChange={(e) => setDocForm({ ...docForm, body: e.target.value })} className="border px-3 py-2 text-sm col-span-2" style={inputStyle} rows={4} />
          </div>
          {docError && <p className="text-xs" style={{ color: 'var(--color-danger)' }}>{docError}</p>}
          <button type="submit" className="px-4 py-2 text-sm font-medium" style={{ borderRadius: 'var(--radius-button)', backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>
            {t('adminContent.documents.submit')}
          </button>
        </form>
        {dLoading && <LoadingState />}
        {dError && <ErrorState message={dError} />}
        {!dLoading && !dError && (!docs || docs.items.length === 0) && <EmptyState title={t('adminContent.documents.empty')} />}
        {!dLoading && !dError && docs && docs.items.length > 0 && (
          <ul className="text-sm space-y-1" style={{ color: 'var(--color-text-secondary)' }}>
            {docs.items.map((d) => (
              <li key={d.id}>
                {d.title} · {d.type} v{d.version} · {d.studioId ? t('adminContent.documents.rowScope.tenant') : t('adminContent.documents.rowScope.global')}{' '}
                {d.publishedAt ? '' : t('adminContent.documents.rowDraft')}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
