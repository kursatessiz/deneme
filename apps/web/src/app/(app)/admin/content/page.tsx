'use client';

import { useState } from 'react';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, ErrorState, EmptyState } from '@/components/common/DataState';
import { useT } from '@/components/i18n/I18nProvider';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { List, ListItem } from '@/components/ui/List';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';

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
    <div className="grid gap-10" key={refreshKey}>
      <section className="grid gap-4">
        <PageHeader title={t('adminContent.templates.title')} description={t('adminContent.templates.subtitle')} />
        <Card>
          <form onSubmit={submitTemplate} className="pui-card-content">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input placeholder={t('adminContent.templates.studioId')} value={tplForm.studioId} onChange={(e) => setTplForm({ ...tplForm, studioId: e.target.value })} />
              <Input required placeholder={t('adminContent.templates.key')} value={tplForm.key} onChange={(e) => setTplForm({ ...tplForm, key: e.target.value })} />
              <Select value={tplForm.channel} onChange={(e) => setTplForm({ ...tplForm, channel: e.target.value })}>
                <option value="SMS">{t('adminContent.templates.channel.SMS')}</option>
                <option value="WHATSAPP">{t('adminContent.templates.channel.WHATSAPP')}</option>
                <option value="PUSH">{t('adminContent.templates.channel.PUSH')}</option>
                <option value="EMAIL">{t('adminContent.templates.channel.EMAIL')}</option>
              </Select>
              {tplForm.channel === 'WHATSAPP' && (
                <Input required placeholder={t('adminContent.templates.whatsappName')} value={tplForm.whatsappTemplateName} onChange={(e) => setTplForm({ ...tplForm, whatsappTemplateName: e.target.value })} />
              )}
              <Textarea required className="sm:col-span-2" placeholder={t('adminContent.templates.body')} value={tplForm.body} onChange={(e) => setTplForm({ ...tplForm, body: e.target.value })} rows={2} />
            </div>
            {tplError && <p className="ui-caption ui-text-error">{tplError}</p>}
            <Button type="submit" className="justify-self-start">
              {t('adminContent.templates.submit')}
            </Button>
          </form>
        </Card>
        {tLoading && <LoadingState />}
        {tError && <ErrorState message={tError} />}
        {!tLoading && !tError && (!templates || templates.items.length === 0) && <EmptyState title={t('adminContent.templates.empty')} />}
        {!tLoading && !tError && templates && templates.items.length > 0 && (
          <Card>
            <List>
              {templates.items.map((tpl) => (
                <ListItem key={tpl.id}>
                  {tpl.key} · {tpl.channel} · {tpl.studioId ? t('adminContent.templates.rowScope.tenant') : t('adminContent.templates.rowScope.global')}{' '}
                  {tpl.isActive ? '' : t('adminContent.templates.rowInactive')}
                </ListItem>
              ))}
            </List>
          </Card>
        )}
      </section>

      <section className="grid gap-4">
        <PageHeader title={t('adminContent.documents.title')} description={t('adminContent.documents.subtitle')} />
        <Card>
          <form onSubmit={submitDocument} className="pui-card-content">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input placeholder={t('adminContent.documents.studioId')} value={docForm.studioId} onChange={(e) => setDocForm({ ...docForm, studioId: e.target.value })} />
              <Select value={docForm.type} onChange={(e) => setDocForm({ ...docForm, type: e.target.value })}>
                <option value="KVKK_NOTICE">{t('adminContent.documents.type.KVKK_NOTICE')}</option>
                <option value="MEMBERSHIP_CONTRACT">{t('adminContent.documents.type.MEMBERSHIP_CONTRACT')}</option>
                <option value="EXPLICIT_CONSENT">{t('adminContent.documents.type.EXPLICIT_CONSENT')}</option>
                <option value="HEALTH_WAIVER">{t('adminContent.documents.type.HEALTH_WAIVER')}</option>
                <option value="HEALTH_DATA">{t('adminContent.documents.type.HEALTH_DATA')}</option>
              </Select>
              <Input required className="sm:col-span-2" placeholder={t('adminContent.documents.titleField')} value={docForm.title} onChange={(e) => setDocForm({ ...docForm, title: e.target.value })} />
              <Textarea required className="sm:col-span-2" placeholder={t('adminContent.documents.body')} value={docForm.body} onChange={(e) => setDocForm({ ...docForm, body: e.target.value })} rows={4} />
            </div>
            {docError && <p className="ui-caption ui-text-error">{docError}</p>}
            <Button type="submit" className="justify-self-start">
              {t('adminContent.documents.submit')}
            </Button>
          </form>
        </Card>
        {dLoading && <LoadingState />}
        {dError && <ErrorState message={dError} />}
        {!dLoading && !dError && (!docs || docs.items.length === 0) && <EmptyState title={t('adminContent.documents.empty')} />}
        {!dLoading && !dError && docs && docs.items.length > 0 && (
          <Card>
            <List>
              {docs.items.map((d) => (
                <ListItem key={d.id}>
                  {d.title} · {d.type} v{d.version} · {d.studioId ? t('adminContent.documents.rowScope.tenant') : t('adminContent.documents.rowScope.global')}{' '}
                  {d.publishedAt ? '' : t('adminContent.documents.rowDraft')}
                </ListItem>
              ))}
            </List>
          </Card>
        )}
      </section>
    </div>
  );
}
