'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  EMAIL_BLOCK_TYPES,
  SMS_PROVIDER_KEYS,
  emailBrandOf,
  interpolateEmailBlocks,
  renderEmail,
  renderMessageTextLenient,
} from '@platform/shared';
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

const fieldStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-background)',
  color: 'var(--color-text-primary)',
};

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
    <label className="block space-y-1">
      <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
        {label}
      </span>
      {multiline ? (
        <textarea value={value} onChange={(e) => set(e.target.value)} rows={3} className="w-full text-sm px-3 py-1.5" style={fieldStyle} />
      ) : (
        <input value={value} onChange={(e) => set(e.target.value)} className="w-full text-sm px-3 py-1.5" style={fieldStyle} />
      )}
    </label>
  );

  return (
    <div className="space-y-2">
      <span className="block text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
        {t('messaging.templates.blocks')}
      </span>
      <ol className="space-y-2">
        {blocks.map((b, i) => (
          <li key={i} className="border p-3 space-y-2" style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-card)' }}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                {t(`messaging.templates.blockType.${b.type}`)}
              </span>
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
        <select value={newType} onChange={(e) => setNewType(e.target.value as EmailBlockType)} className="text-sm px-3 py-1.5" style={fieldStyle}>
          {EMAIL_BLOCK_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`messaging.templates.blockType.${type}`)}
            </option>
          ))}
        </select>
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
      draft.blocks.length > 0 ? draft.blocks : [{ type: 'heading', text: draft.subject || ' ' }, { type: 'paragraph', text: draft.body || ' ' }];
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
      <span className="block text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
        {t('messaging.templates.preview')}
      </span>
      {/* Empty sandbox: no scripts, no navigation, no same-origin access from the rendered email. */}
      <iframe
        title={t('messaging.templates.previewFrame')}
        sandbox=""
        srcDoc={html}
        className="w-full border"
        style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-card)', height: 560, backgroundColor: '#ffffff' }}
      />
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
              <TextField label={t('messaging.templates.keyLabel')} value={draft.key} onChange={(v) => set('key', v.toUpperCase())} placeholder="SPRING_OFFER" />
              <label className="block space-y-1">
                <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                  {t('messaging.templates.filter.channel')}
                </span>
                <select value={draft.channel} onChange={(e) => set('channel', e.target.value as EditableChannel)} className="w-full text-sm px-3 py-2" style={fieldStyle}>
                  {CHANNELS.map((c) => (
                    <option key={c} value={c}>
                      {t(`messaging.channel.${c}`)}
                    </option>
                  ))}
                </select>
              </label>
              <TextField label={t('messaging.templates.localeLabel')} value={draft.locale} onChange={(v) => set('locale', v.trim())} placeholder="tr" />
            </div>
          )}
          {isNew && <InlineMessage text={t('messaging.templates.keyHint')} />}
          {draft.channel === 'EMAIL' && <TextField label={t('messaging.templates.subject')} value={draft.subject} onChange={(v) => set('subject', v)} />}
          <label className="block space-y-1">
            <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              {t('messaging.templates.body')}
            </span>
            <textarea value={draft.body} onChange={(e) => set('body', e.target.value)} rows={4} maxLength={2000} className="w-full text-sm px-3 py-2" style={fieldStyle} />
          </label>
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
          <label className="block space-y-1">
            <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              {t('messaging.templates.purpose')}
            </span>
            <select
              value={draft.isTransactional ? 'T' : 'C'}
              onChange={(e) => set('isTransactional', e.target.value === 'T')}
              className="w-full text-sm px-3 py-2"
              style={fieldStyle}
            >
              <option value="T">{t('messaging.templates.purpose.transactional')}</option>
              <option value="C">{t('messaging.templates.purpose.commercial')}</option>
            </select>
          </label>
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
              <span className="block text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                {t('messaging.templates.previewText')}
              </span>
              <p
                className="text-sm whitespace-pre-wrap border p-3"
                style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-card)', color: 'var(--color-text-primary)' }}
              >
                {textPreview}
              </p>
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
        <label className="block space-y-1">
          <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            {t('messaging.settings.smsProvider')}
          </span>
          <select value={smsProvider} onChange={(e) => setSmsProvider(e.target.value as SmsProviderKey | '')} className="w-full text-sm px-3 py-2" style={fieldStyle}>
            <option value="">{t('messaging.settings.smsProvider.auto')}</option>
            {SMS_PROVIDER_KEYS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <TextField label={t('messaging.settings.emailFromName')} value={fromName} onChange={setFromName} />
        <TextField label={t('messaging.settings.emailReplyTo')} type="email" value={replyTo} onChange={setReplyTo} />
      </div>
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
    <div className="space-y-6">
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
          <label className="space-y-1">
            <span className="block text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              {t('messaging.templates.filter.key')}
            </span>
            <select value={keyFilter} onChange={(e) => setKeyFilter(e.target.value)} className="text-sm px-3 py-1.5" style={fieldStyle}>
              <option value="">{t('messaging.inbox.filter.all')}</option>
              {keys.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              {t('messaging.templates.filter.channel')}
            </span>
            <select value={channel} onChange={(e) => setChannel(e.target.value as EditableChannel | '')} className="text-sm px-3 py-1.5" style={fieldStyle}>
              <option value="">{t('messaging.inbox.filter.anyChannel')}</option>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {t(`messaging.channel.${c}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              {t('messaging.templates.filter.locale')}
            </span>
            <select value={locale} onChange={(e) => setLocale(e.target.value)} className="text-sm px-3 py-1.5" style={fieldStyle}>
              <option value="">{t('messaging.inbox.filter.all')}</option>
              {locales.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
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
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  <th className="py-2 pr-3 font-medium">{t('messaging.templates.filter.key')}</th>
                  <th className="py-2 pr-3 font-medium">{t('messaging.templates.filter.channel')}</th>
                  <th className="py-2 pr-3 font-medium">{t('messaging.templates.filter.locale')}</th>
                  <th className="py-2 pr-3 font-medium">{t('messaging.templates.purpose')}</th>
                  <th className="py-2 pr-3 font-medium" />
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.key}-${row.channel}-${row.locale}`} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                    <td className="py-2 pr-3 font-mono text-xs" style={{ color: 'var(--color-text-primary)' }}>
                      {row.key}
                    </td>
                    <td className="py-2 pr-3">{t(`messaging.channel.${row.channel}`)}</td>
                    <td className="py-2 pr-3">{row.locale}</td>
                    <td className="py-2 pr-3">
                      {row.isTransactional ? t('messaging.templates.purpose.transactional') : t('messaging.templates.purpose.commercial')}
                    </td>
                    <td className="py-2 pr-3 space-x-1">
                      <Badge tone={row.source === 'TENANT' ? 'info' : 'neutral'}>{t(`messaging.templates.source.${row.source}`)}</Badge>
                      {row.channel === 'WHATSAPP' && row.whatsappStatus && (
                        <Badge tone={row.whatsappStatus === 'APPROVED' ? 'success' : 'warning'}>
                          {t(`messaging.templates.whatsappStatus.${row.whatsappStatus}`)}
                        </Badge>
                      )}
                      {!row.isActive && <Badge>{t('messaging.templates.inactive')}</Badge>}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap space-x-1">
                      <SecondaryButton onClick={() => setEditing({ isNew: false, draft: draftFrom(row) })}>{t('messaging.templates.edit')}</SecondaryButton>
                      {row.source === 'TENANT' && row.id && (
                        <SecondaryButton danger onClick={() => removeOverride(row.id!)}>
                          {t('messaging.templates.removeOverride')}
                        </SecondaryButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
