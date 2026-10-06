'use client';

import { useEffect, useMemo, useState } from 'react';
import { EMAIL_BLOCK_TYPES, SMS_PROVIDER_KEYS, emailBrandOf, interpolateEmailBlocks, renderEmail, renderMessageTextLenient } from '@platform/shared';
import type {
  EmailBlock,
  EmailBlockType,
  MessageTemplateDTO,
  MessageTemplateListDTO,
  ResolvedMessagingSettings,
  SmsProviderKey,
  TemplatePreviewBrandDTO,
} from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { PageGuard } from '@/components/common/PageGuard';
import { Badge } from '@/components/common/Badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/DataState';
import { InlineMessage, PrimaryButton, Section, SecondaryButton, SettingsHeader, TextField, Toggle } from '@/components/settings/ui';
import { bffFetch, BffError } from '@/lib/session/client';
import { AiDraftPanel } from '@/components/ai/AiDraftPanel';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { FieldGroup } from '@/components/ui/FieldGroup';
import { Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui/Table';

type EditableChannel = 'SMS' | 'WHATSAPP' | 'EMAIL';
const CHANNELS: readonly EditableChannel[] = ['SMS', 'WHATSAPP', 'EMAIL'];

interface Draft {
  key: string;
  channel: EditableChannel;
  locale: string;
  body: string;
  subject: string;
  blocks: EmailBlock[];
  whatsappTemplateName: string;
  isTransactional: boolean;
  isActive: boolean;
}

function draftFrom(t: MessageTemplateDTO): Draft {
  return {
    key: t.key,
    channel: t.channel as EditableChannel,
    locale: t.locale,
    body: t.body,
    subject: t.subject ?? '',
    blocks: t.blocks ?? [],
    whatsappTemplateName: t.whatsappTemplateName ?? '',
    isTransactional: t.isTransactional,
    isActive: t.isActive,
  };
}

function emptyBlock(type: EmailBlockType): EmailBlock {
  switch (type) {
    case 'heading':
      return { type, text: '' };
    case 'paragraph':
      return { type, text: '' };
    case 'button':
      return { type, label: '', url: 'https://' };
    case 'image':
      return { type, src: 'https://', alt: '' };
    case 'divider':
      return { type };
    case 'footer':
      return { type, text: '' };
  }
}

function BlockEditor({ blocks, onChange }: { blocks: EmailBlock[]; onChange: (next: EmailBlock[]) => void }) {
  const t = useT();
  const [newType, setNewType] = useState<EmailBlockType>('paragraph');
  const update = (i: number, block: EmailBlock) => onChange(blocks.map((b, j) => (j === i ? block : b)));
  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const input = (label: string, value: string, set: (v: string) => void, multiline = false) => (
    <FieldGroup label={label}>
      {multiline ? <Textarea value={value} onChange={(e) => set(e.target.value)} rows={3} /> : <Input value={value} onChange={(e) => set(e.target.value)} />}
    </FieldGroup>
  );

  return (
    <div className="space-y-2">
      <span className="block ui-caption ui-strong">{t('messaging.templates.blocks')}</span>
      <ol className="space-y-2">
        {blocks.map((b, i) => (
          <li key={i} className="ui-panel grid gap-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="ui-caption ui-strong">{t(`messaging.templates.blockType.${b.type}`)}</span>
              <div className="flex gap-1">
                <SecondaryButton onClick={() => move(i, -1)} disabled={i === 0}>
                  {t('messaging.templates.block.up')}
                </SecondaryButton>
                <SecondaryButton onClick={() => move(i, 1)} disabled={i === blocks.length - 1}>
                  {t('messaging.templates.block.down')}
                </SecondaryButton>
                <SecondaryButton danger onClick={() => onChange(blocks.filter((_, j) => j !== i))}>
                  {t('messaging.templates.block.remove')}
                </SecondaryButton>
              </div>
            </div>
            {(b.type === 'heading' || b.type === 'paragraph' || b.type === 'footer') &&
              input(t('messaging.templates.block.text'), b.text, (v) => update(i, { ...b, text: v }), b.type !== 'heading')}
            {b.type === 'button' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {input(t('messaging.templates.block.label'), b.label, (v) => update(i, { ...b, label: v }))}
                {input(t('messaging.templates.block.url'), b.url, (v) => update(i, { ...b, url: v }))}
              </div>
            )}
            {b.type === 'image' && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {input(t('messaging.templates.block.src'), b.src, (v) => update(i, { ...b, src: v }))}
                {input(t('messaging.templates.block.alt'), b.alt, (v) => update(i, { ...b, alt: v }))}
                {input(t('messaging.templates.block.url'), b.href ?? '', (v) => update(i, v ? { ...b, href: v } : { type: 'image', src: b.src, alt: b.alt }))}
              </div>
            )}
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-2">
        <Select value={newType} onChange={(e) => setNewType(e.target.value as EmailBlockType)}>
          {EMAIL_BLOCK_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`messaging.templates.blockType.${type}`)}
            </option>
          ))}
        </Select>
        <SecondaryButton onClick={() => onChange([...blocks, emptyBlock(newType)])}>{t('messaging.templates.addBlock')}</SecondaryButton>
      </div>
    </div>
  );
}

/** The same renderer the API sends with (packages/shared email-blocks), so the preview is exactly what recipients get. */
function EmailPreview({ draft, brand, origin }: { draft: Draft; brand: TemplatePreviewBrandDTO; origin: string }) {
  const t = useT();
  const html = useMemo(() => {
    const variables = { studioName: brand.studioName };
    const source: EmailBlock[] =
      draft.blocks.length > 0
        ? draft.blocks
        : [
            { type: 'heading', text: draft.subject || ' ' },
            { type: 'paragraph', text: draft.body || ' ' },
          ];
    const commercial = !draft.isTransactional;
    return renderEmail({
      lang: draft.locale,
      subject: renderMessageTextLenient(draft.subject, variables, draft.locale),
      blocks: interpolateEmailBlocks(source, variables, draft.locale, true),
      brand: emailBrandOf({
        name: brand.studioName,
        logoUrl: brand.logoUrl,
        themeFamily: brand.themeFamily,
        themePrimary: brand.themePrimary,
        gradientPresetKey: brand.gradientPresetKey,
      }),
      footer: {
        physicalAddress: brand.address,
        reasonText: t(commercial ? 'msgTpl.email.reasonCommercial' : 'msgTpl.email.reasonTransactional', { studioName: brand.studioName }),
        unsubscribe: commercial ? { url: `${origin}/m/u/preview`, label: t('msgTpl.email.unsubscribe') } : null,
      },
    }).html;
  }, [draft, brand, origin, t]);

  return (
    <div className="space-y-1">
      <span className="block ui-caption ui-strong">{t('messaging.templates.preview')}</span>
      {/* Empty sandbox: no scripts, no navigation, no same-origin access from the rendered email. */}
      <div className="ui-panel p-2">
        <iframe title={t('messaging.templates.previewFrame')} sandbox="" srcDoc={html} className="w-full" style={{ height: 560, colorScheme: 'light' }} />
      </div>
      {!draft.isTransactional && !brand.address && <InlineMessage tone="error" text={t('messaging.templates.addressMissing')} />}
    </div>
  );
}

function TemplateEditor({
  studioId,
  initial,
  brand,
  isNew,
  onSaved,
  onCancel,
}: {
  studioId: string;
  initial: Draft;
  brand: TemplatePreviewBrandDTO;
  isNew: boolean;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [origin, setOrigin] = useState('https://localhost');

  useEffect(() => {
    setDraft(initial);
    setMessage(null);
  }, [initial]);
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      await bffFetch(`studios/${studioId}/messaging/templates`, {
        method: 'PUT',
        studioId,
        body: {
          key: draft.key,
          channel: draft.channel,
          locale: draft.locale,
          body: draft.body,
          ...(draft.channel === 'EMAIL' ? { subject: draft.subject, blocks: draft.blocks.length > 0 ? draft.blocks : null } : {}),
          ...(draft.channel === 'WHATSAPP' ? { whatsappTemplateName: draft.whatsappTemplateName } : {}),
          isTransactional: draft.isTransactional,
          isActive: draft.isActive,
        },
      });
      setMessage({ text: t('messaging.templates.saved'), tone: 'success' });
      onSaved();
    } catch (err) {
      setMessage({ text: err instanceof BffError ? err.message : t('messaging.templates.saveError'), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const textPreview = renderMessageTextLenient(draft.body, { studioName: brand.studioName }, draft.locale);

  return (
    <Section title={t('messaging.templates.editing', { key: draft.key || '-', channel: t(`messaging.channel.${draft.channel}`), locale: draft.locale })}>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="space-y-3">
          {isNew && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <TextField label={t('messaging.templates.keyLabel')} value={draft.key} onChange={(v) => set('key', v.toUpperCase())} placeholder={t('messaging.templates.keyPlaceholder')} />
              <FieldGroup label={t('messaging.templates.filter.channel')}>
                <Select value={draft.channel} onChange={(e) => set('channel', e.target.value as EditableChannel)}>
                  {CHANNELS.map((c) => (
                    <option key={c} value={c}>
                      {t(`messaging.channel.${c}`)}
                    </option>
                  ))}
                </Select>
              </FieldGroup>
              <TextField label={t('messaging.templates.localeLabel')} value={draft.locale} onChange={(v) => set('locale', v.trim())} placeholder="tr" />
            </div>
          )}
          {isNew && <InlineMessage text={t('messaging.templates.keyHint')} />}
          {draft.channel === 'EMAIL' && <TextField label={t('messaging.templates.subject')} value={draft.subject} onChange={(v) => set('subject', v)} />}
          <FieldGroup label={t('messaging.templates.body')}>
            <Textarea value={draft.body} onChange={(e) => set('body', e.target.value)} rows={4} maxLength={2000} />
          </FieldGroup>
          {draft.channel === 'EMAIL' && <InlineMessage text={t('messaging.templates.bodyHintEmail')} />}
          <AiDraftPanel
            kinds={draft.channel === 'EMAIL' ? ['EMAIL'] : draft.channel === 'SMS' ? ['SMS', 'CAMPAIGN'] : ['CAMPAIGN', 'SMS']}
            locale={draft.locale || undefined}
            onUse={(result) =>
              setDraft((d) => ({ ...d, body: result.text.slice(0, 2000), ...(d.channel === 'EMAIL' && result.subject ? { subject: result.subject } : {}) }))
            }
          />
          {draft.channel === 'WHATSAPP' && (
            <>
              <TextField label={t('messaging.templates.whatsappName')} value={draft.whatsappTemplateName} onChange={(v) => set('whatsappTemplateName', v)} />
              <InlineMessage text={t('messaging.templates.whatsappPendingHint')} />
            </>
          )}
          <FieldGroup label={t('messaging.templates.purpose')}>
            <Select value={draft.isTransactional ? 'T' : 'C'} onChange={(e) => set('isTransactional', e.target.value === 'T')}>
              <option value="T">{t('messaging.templates.purpose.transactional')}</option>
              <option value="C">{t('messaging.templates.purpose.commercial')}</option>
            </Select>
          </FieldGroup>
          {!draft.isTransactional && <InlineMessage text={t('messaging.templates.purposeHint')} />}
          <Toggle label={t('messaging.templates.active')} checked={draft.isActive} onChange={(v) => set('isActive', v)} />
          {draft.channel === 'EMAIL' && <BlockEditor blocks={draft.blocks} onChange={(blocks) => set('blocks', blocks)} />}
          {message && <InlineMessage text={message.text} tone={message.tone} />}
          <div className="flex gap-2">
            <PrimaryButton onClick={save} disabled={busy || !draft.key || !draft.body.trim()}>
              {t('messaging.templates.save')}
            </PrimaryButton>
            <SecondaryButton onClick={onCancel}>{t('messaging.templates.cancel')}</SecondaryButton>
          </div>
        </div>
        <div>
          {draft.channel === 'EMAIL' ? (
            <EmailPreview draft={draft} brand={brand} origin={origin} />
          ) : (
            <div className="space-y-1">
              <span className="block ui-caption ui-strong">{t('messaging.templates.previewText')}</span>
              <p className="ui-panel whitespace-pre-wrap p-3">{textPreview}</p>
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

function SendingSettings({ studioId }: { studioId: string }) {
  const t = useT();
  const [settings, setSettings] = useState<ResolvedMessagingSettings | null>(null);
  const [perDay, setPerDay] = useState('3');
  const [perWeek, setPerWeek] = useState('10');
  const [sendTime, setSendTime] = useState('');
  const [smsProvider, setSmsProvider] = useState<SmsProviderKey | ''>('');
  const [fromName, setFromName] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);

  useEffect(() => {
    bffFetch<ResolvedMessagingSettings>(`studios/${studioId}/messaging/settings`, { studioId })
      .then((s) => {
        setSettings(s);
        setPerDay(String(s.frequencyCap.perDay));
        setPerWeek(String(s.frequencyCap.perWeek));
        setSendTime(s.defaultSendTimeLocal);
        setSmsProvider(s.smsProvider ?? '');
        setFromName(s.emailFromName ?? '');
        setReplyTo(s.emailReplyTo ?? '');
      })
      .catch(() => setSettings(null));
  }, [studioId]);

  async function save() {
    setMessage(null);
    try {
      await bffFetch(`studios/${studioId}/messaging/settings`, {
        method: 'PUT',
        studioId,
        body: {
          frequencyCap: { perDay: Number(perDay), perWeek: Number(perWeek) },
          ...(sendTime ? { defaultSendTimeLocal: sendTime } : {}),
          smsProvider: smsProvider || null,
          emailFromName: fromName.trim() || null,
          emailReplyTo: replyTo.trim() || null,
        },
      });
      setMessage({ text: t('messaging.settings.saved'), tone: 'success' });
    } catch (err) {
      setMessage({ text: err instanceof BffError ? err.message : t('messaging.settings.saveError'), tone: 'error' });
    }
  }

  if (!settings) return null;
  return (
    <Section title={t('messaging.settings.title')} description={t('messaging.templates.settingsDescription')}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextField label={t('messaging.settings.perDay')} type="number" value={perDay} onChange={setPerDay} />
        <TextField label={t('messaging.settings.perWeek')} type="number" value={perWeek} onChange={setPerWeek} />
        <TextField label={t('messaging.settings.defaultSendTime')} type="time" value={sendTime} onChange={setSendTime} />
        <FieldGroup label={t('messaging.settings.smsProvider')}>
          <Select value={smsProvider} onChange={(e) => setSmsProvider(e.target.value as SmsProviderKey | '')}>
            <option value="">{t('messaging.settings.smsProvider.auto')}</option>
            {SMS_PROVIDER_KEYS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </Select>
        </FieldGroup>
        <TextField label={t('messaging.settings.emailFromName')} value={fromName} onChange={setFromName} />
        <TextField label={t('messaging.settings.emailReplyTo')} type="email" value={replyTo} onChange={setReplyTo} />
      </div>
      <p className="ui-caption">{t('messaging.settings.defaultSendTimeHint')}</p>
      {message && <InlineMessage text={message.text} tone={message.tone} />}
      <PrimaryButton onClick={save}>{t('messaging.settings.save')}</PrimaryButton>
    </Section>
  );
}

function Templates() {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const [channel, setChannel] = useState<EditableChannel | ''>('');
  const [locale, setLocale] = useState('');
  const [keyFilter, setKeyFilter] = useState('');
  const [data, setData] = useState<MessageTemplateListDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ draft: Draft; isNew: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams();
    if (channel) params.set('channel', channel);
    if (locale) params.set('locale', locale);
    let cancelled = false;
    setError(null);
    bffFetch<MessageTemplateListDTO>(`studios/${activeStudioId}/messaging/templates?${params.toString()}`, { studioId: activeStudioId })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof BffError ? err.message : t('common.error.generic'));
      });
    return () => {
      cancelled = true;
    };
  }, [activeStudioId, channel, locale, reloadKey, t]);

  const keys = useMemo(() => [...new Set((data?.items ?? []).map((i) => i.key))].sort(), [data]);
  const locales = useMemo(() => [...new Set((data?.items ?? []).map((i) => i.locale))].sort(), [data]);
  const rows = (data?.items ?? []).filter((i) => (!keyFilter || i.key === keyFilter) && CHANNELS.includes(i.channel as EditableChannel));

  async function removeOverride(id: string) {
    setNotice(null);
    try {
      await bffFetch(`studios/${activeStudioId}/messaging/templates/${id}`, { method: 'DELETE', studioId: activeStudioId });
      setNotice(t('messaging.templates.removed'));
      setEditing(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setNotice(err instanceof BffError ? err.message : t('common.error.generic'));
    }
  }

  return (
    <div className="grid gap-6">
      <SettingsHeader title={t('messaging.templates.title')} description={t('messaging.templates.subtitle')} />
      <SendingSettings studioId={activeStudioId} />

      {editing && data && (
        <TemplateEditor
          studioId={activeStudioId}
          initial={editing.draft}
          brand={data.brand}
          isNew={editing.isNew}
          onSaved={() => setReloadKey((k) => k + 1)}
          onCancel={() => setEditing(null)}
        />
      )}

      <Section title={t('messaging.templates.list')}>
        <div className="flex flex-wrap items-end gap-3">
          <FieldGroup label={t('messaging.templates.filter.key')}>
            <Select value={keyFilter} onChange={(e) => setKeyFilter(e.target.value)}>
              <option value="">{t('messaging.inbox.filter.all')}</option>
              {keys.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </Select>
          </FieldGroup>
          <FieldGroup label={t('messaging.templates.filter.channel')}>
            <Select value={channel} onChange={(e) => setChannel(e.target.value as EditableChannel | '')}>
              <option value="">{t('messaging.inbox.filter.anyChannel')}</option>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {t(`messaging.channel.${c}`)}
                </option>
              ))}
            </Select>
          </FieldGroup>
          <FieldGroup label={t('messaging.templates.filter.locale')}>
            <Select value={locale} onChange={(e) => setLocale(e.target.value)}>
              <option value="">{t('messaging.inbox.filter.all')}</option>
              {locales.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          </FieldGroup>
          <SecondaryButton
            onClick={() =>
              setEditing({
                isNew: true,
                draft: {
                  key: '',
                  channel: 'EMAIL',
                  locale: data?.brand.defaultLocale ?? 'tr',
                  body: '',
                  subject: '',
                  blocks: [],
                  whatsappTemplateName: '',
                  isTransactional: false,
                  isActive: true,
                },
              })
            }
          >
            {t('messaging.templates.newTemplate')}
          </SecondaryButton>
        </div>
        {notice && <InlineMessage text={notice} />}
        {error && <ErrorState message={error} />}
        {!error && !data && <LoadingState />}
        {!error && data && rows.length === 0 && <EmptyState title={t('messaging.templates.empty')} />}
        {!error && data && rows.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Tr>
                  <Th>{t('messaging.templates.filter.key')}</Th>
                  <Th>{t('messaging.templates.filter.channel')}</Th>
                  <Th>{t('messaging.templates.filter.locale')}</Th>
                  <Th>{t('messaging.templates.purpose')}</Th>
                  <Th />
                  <Th />
                </Tr>
              </Thead>
              <Tbody>
                {rows.map((row) => (
                  <Tr key={`${row.key}-${row.channel}-${row.locale}`}>
                    <Td className="ui-mono ui-caption">{row.key}</Td>
                    <Td>{t(`messaging.channel.${row.channel}`)}</Td>
                    <Td>{row.locale}</Td>
                    <Td>{row.isTransactional ? t('messaging.templates.purpose.transactional') : t('messaging.templates.purpose.commercial')}</Td>
                    <Td className="space-x-1">
                      <Badge tone={row.source === 'TENANT' ? 'info' : 'neutral'}>{t(`messaging.templates.source.${row.source}`)}</Badge>
                      {row.channel === 'WHATSAPP' && row.whatsappStatus && (
                        <Badge tone={row.whatsappStatus === 'APPROVED' ? 'success' : 'warning'}>
                          {t(`messaging.templates.whatsappStatus.${row.whatsappStatus}`)}
                        </Badge>
                      )}
                      {!row.isActive && <Badge>{t('messaging.templates.inactive')}</Badge>}
                    </Td>
                    <Td className="text-right whitespace-nowrap space-x-1">
                      <SecondaryButton onClick={() => setEditing({ isNew: false, draft: draftFrom(row) })}>{t('messaging.templates.edit')}</SecondaryButton>
                      {row.source === 'TENANT' && row.id && (
                        <SecondaryButton danger onClick={() => removeOverride(row.id!)}>
                          {t('messaging.templates.removeOverride')}
                        </SecondaryButton>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        )}
      </Section>
    </div>
  );
}

export default function MessageTemplatesPage() {
  return (
    <PageGuard required={['notifications.manage']}>
      <Templates />
    </PageGuard>
  );
}
